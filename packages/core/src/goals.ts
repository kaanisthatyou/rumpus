// Goal mode (PLAN.md 5.5). A person sets a goal for an agent with a budget and an optional done check. The agent
// writes a plan; the person approves it, with comments on any step; then each step is one job, followed by the
// check, until the goal is done, the budget runs out, a step fails, or someone stops it. Every step continues the
// person's approved goal, so work still starts only from a person.

import { join } from 'node:path';
import type {
  Agent,
  Channel,
  Goal,
  GoalBudget,
  GoalComment,
  GoalInput,
  GoalPause,
  GoalStep,
  Job,
  Language,
  Message,
} from '@lonca/protocol';
import { CoreError } from '@lonca/protocol';
import { newId } from './ids.js';
import type { Jobs } from './jobs.js';
import type { Runner } from './proc.js';
import type { WorkspaceStore } from './store.js';

const LANGUAGE_NAMES: Record<Language, string> = { tr: 'Turkish', en: 'English' };
export const MAX_PLAN_STEPS = 30;
const DONE_MARK = /^\s*GOAL_DONE\s*$/m;

export interface GitWorktrees {
  isRepo(folder: string): Promise<boolean>;
  add(repo: string, path: string, branch: string): Promise<{ ok: boolean; output: string }>;
  remove(repo: string, path: string): Promise<{ ok: boolean; output: string }>;
}

/** Git worktrees through the git CLI. Removal never forces: a worktree with changes stays. */
export function gitWorktrees(runner: Runner): GitWorktrees {
  const git = async (args: string[]) => {
    const r = await runner('git', args, { timeoutMs: 60_000 });
    return { ok: !r.failed && r.code === 0, output: `${r.stdout}\n${r.stderr}`.trim() };
  };
  return {
    isRepo: async (folder) => {
      const r = await git(['-C', folder, 'rev-parse', '--is-inside-work-tree']);
      return r.ok && r.output.startsWith('true');
    },
    add: (repo, path, branch) => git(['-C', repo, 'worktree', 'add', '-b', branch, path, 'HEAD']),
    remove: (repo, path) => git(['-C', repo, 'worktree', 'remove', path]),
  };
}

export interface GoalsDeps {
  store: WorkspaceStore;
  jobs: Pick<Jobs, 'startWith' | 'busy' | 'stop' | 'closeScope'>;
  me(): { id: string; name: string; language: Language };
  emitGoal(goal: Goal): void;
  emitMessage(message: Message): void;
  /** Runs the done check in the agent's folder; exit code 0 is a pass. */
  runCheck(command: string, cwd: string): Promise<{ ok: boolean; output: string }>;
  /** Worktrees for goals that run apart, and where they go. */
  git?: GitWorktrees;
  worktreesDir?: string;
  /** A step finished: advisors may comment on its report. */
  onStep?(goal: Goal, step: GoalStep, report: string): void;
  now?(): number;
  /** How long to wait before trying again when the agent is busy with something else. */
  retryMs?: number;
}

/** The steps of a plan: a numbered list (or, failing that, a bulleted one). */
export function parsePlan(text: string): string[] {
  const lines = text.split('\n');
  const pick = (re: RegExp) =>
    lines
      .map((l) => re.exec(l)?.[1]?.trim())
      .filter((s): s is string => Boolean(s))
      .map((s) => s.replace(/\*\*/g, '').replace(/`/g, '').slice(0, 300));
  const numbered = pick(/^\s*\d+[.)]\s+(.+)$/);
  const steps = numbered.length ? numbered : pick(/^\s*[-*]\s+(.+)$/);
  return steps.slice(0, MAX_PLAN_STEPS);
}

function cleanBudget(b: Partial<GoalBudget> | undefined): GoalBudget {
  const int = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  const tokens = b?.tokens === undefined ? undefined : int(b.tokens, 1000, 100_000_000, Number.NaN);
  if (Number.isNaN(tokens)) throw new CoreError('invalid_goal', 'tokens');
  return {
    steps: int(b?.steps, 1, 50, 10),
    minutes: int(b?.minutes, 1, 24 * 60, 60),
    ...(tokens !== undefined ? { tokens } : {}),
  };
}

/** A goal in its own worktree runs in a session of its own. */
const scopeOf = (goal: Goal) => (goal.worktree ? goal.id : undefined);
const where = (goal: Goal) => (goal.worktree ? { folder: goal.worktree.path, scope: goal.id } : {});

export class Goals {
  private readonly timers = new Set<NodeJS.Timeout>();
  private disposed = false;

  constructor(private readonly deps: GoalsDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  list(): Goal[] {
    return this.deps.store.goals();
  }

  private save(goal: Goal): Goal {
    this.deps.store.commit({ type: 'goal.saved', data: goal });
    this.deps.emitGoal(goal);
    return goal;
  }

  private get(id: unknown): Goal {
    const goal = typeof id === 'string' ? this.deps.store.goal(id) : undefined;
    if (!goal) throw new CoreError('not_found');
    return goal;
  }

  /** Goals that were working when the app closed cannot continue on their own: they wait for a person. */
  recover(): void {
    for (const g of this.list()) {
      if (g.state !== 'planning' && g.state !== 'running') continue;
      this.save({
        ...g,
        state: 'paused',
        pause: 'interrupted',
        steps: g.steps.map((s) => (s.state === 'running' ? { ...s, state: 'pending' } : s)),
      });
    }
  }

  async create(input: GoalInput): Promise<Goal> {
    const { store } = this.deps;
    const channel = typeof input?.channelId === 'string' ? store.channel(input.channelId) : undefined;
    if (!channel) throw new CoreError('not_found', 'channel');
    const agent = typeof input.agentId === 'string' ? store.agent(input.agentId) : undefined;
    if (!agent) throw new CoreError('invalid_goal', 'agent');
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!text || text.length > 4000) throw new CoreError('invalid_goal', 'text');
    const check = typeof input.check === 'string' ? input.check.trim() : '';
    if (check.length > 500 || /[\r\n]/.test(check)) throw new CoreError('invalid_goal', 'check');
    const apart = input.worktree === true;
    // Two goals of one agent may run at once only when they do not share a folder.
    if (
      !apart &&
      this.list().some(
        (g) => g.agentId === agent.id && !g.worktree && ['planning', 'review', 'running'].includes(g.state),
      )
    )
      throw new CoreError('busy');
    const id = newId();
    let worktree: Goal['worktree'];
    if (apart) {
      const { git, worktreesDir } = this.deps;
      if (!git || !worktreesDir) throw new CoreError('invalid_goal', 'worktree');
      if (!(await git.isRepo(agent.folder))) throw new CoreError('not_git');
      const branch = `lonca/goal-${id.slice(-6).toLowerCase()}`;
      const path = join(worktreesDir, id);
      const made = await git.add(agent.folder, path, branch);
      if (!made.ok) throw new CoreError('worktree_failed', made.output.slice(-400));
      worktree = { path, branch };
    }
    const me = this.deps.me();
    const request: Message = {
      id: newId(),
      channelId: channel.id,
      author: { kind: 'person', id: me.id, name: me.name },
      text: `/goal ${text}`,
      created: this.now(),
    };
    store.commit({ type: 'message.posted', data: request });
    this.deps.emitMessage(request);
    const goal = this.save({
      id,
      channelId: channel.id,
      agentId: agent.id,
      requestId: request.id,
      text,
      state: 'planning',
      steps: [],
      comments: [],
      budget: cleanBudget(input.budget),
      ...(check ? { check } : {}),
      ...(worktree ? { worktree } : {}),
      used: { steps: 0, tokens: 0, ms: 0 },
      created: this.now(),
    });
    void this.startPlan(goal.id);
    return goal;
  }

  approve(id: string, comments: GoalComment[]): Goal {
    const goal = this.get(id);
    if (goal.state !== 'review') throw new CoreError('goal_state');
    const list = Array.isArray(comments) ? comments.slice(0, 30) : [];
    const clean: GoalComment[] = [];
    for (const c of list) {
      const text = typeof c?.text === 'string' ? c.text.trim().slice(0, 1000) : '';
      if (!text) continue;
      const onStep = typeof c.stepId === 'string' && goal.steps.some((s) => s.id === c.stepId);
      clean.push({ ...(onStep ? { stepId: c.stepId } : {}), text });
    }
    const next = this.save({ ...goal, state: 'running', comments: clean });
    void this.runNext(next.id);
    return next;
  }

  async removeWorktree(id: string): Promise<Goal> {
    const goal = this.get(id);
    if (!goal.worktree || goal.worktree.removed) throw new CoreError('goal_state');
    if (['planning', 'review', 'running'].includes(goal.state)) throw new CoreError('goal_state');
    const agent = this.deps.store.agent(goal.agentId);
    if (!agent || !this.deps.git) throw new CoreError('not_found');
    this.release(goal);
    // The session's process may take a moment to let go of the folder (Windows keeps it locked until then).
    let r = await this.deps.git.remove(agent.folder, goal.worktree.path);
    for (let i = 0; !r.ok && i < 5 && /denied|busy|used by another|unable to|Permission/i.test(r.output); i++) {
      await new Promise((ok) => setTimeout(ok, 400));
      r = await this.deps.git.remove(agent.folder, goal.worktree.path);
    }
    if (!r.ok) throw new CoreError('worktree_failed', r.output.slice(-400));
    return this.save({ ...goal, worktree: { ...goal.worktree, removed: true } });
  }

  stop(id: string): Goal {
    const goal = this.get(id);
    if (['done', 'failed', 'stopped'].includes(goal.state)) return goal;
    const stopped = this.save({
      ...goal,
      state: 'stopped',
      ended: this.now(),
      steps: goal.steps.map((s) => (s.state === 'running' ? { ...s, state: 'failed' } : s)),
    });
    const running =
      goal.steps.find((s) => s.state === 'running')?.jobId ?? (goal.state === 'planning' ? goal.planJobId : undefined);
    if (running) this.deps.jobs.stop(running);
    this.release(stopped);
    return stopped;
  }

  resume(id: string, more: Partial<GoalBudget> = {}): Goal {
    const goal = this.get(id);
    if (goal.state !== 'paused') throw new CoreError('goal_state');
    const add = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
    const budget: GoalBudget = {
      steps: Math.min(100, goal.budget.steps + add(more.steps, 50)),
      minutes: Math.min(48 * 60, goal.budget.minutes + add(more.minutes, 24 * 60)),
      ...(goal.budget.tokens !== undefined ? { tokens: goal.budget.tokens + add(more.tokens, 100_000_000) } : {}),
    };
    const { pause: _pause, ...rest } = goal;
    if (goal.steps.length === 0) {
      const planning = this.save({ ...rest, state: 'planning', budget });
      void this.startPlan(planning.id);
      return planning;
    }
    const running = this.save({
      ...rest,
      state: 'running',
      budget,
      steps: goal.steps.map((s) => (s.state === 'failed' ? { ...s, state: 'pending' } : s)),
    });
    void this.runNext(running.id);
    return running;
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  // ---------------------------------------------------------------- running

  /** A goal in its own worktree that has ended no longer needs its session. */
  private release(goal: Goal): void {
    if (goal.worktree) this.deps.jobs.closeScope(goal.agentId, goal.channelId, goal.id);
  }

  private later(fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, this.deps.retryMs ?? 3000);
    this.timers.add(t);
  }

  private context(goal: Goal): { agent: Agent; channel: Channel; request: Message } | undefined {
    const { store } = this.deps;
    const agent = store.agent(goal.agentId);
    const channel = store.channel(goal.channelId);
    const request = store.message(goal.requestId);
    if (!agent || !channel || !request) return undefined;
    return { agent, channel, request };
  }

  private pause(goal: Goal, pause: GoalPause): Goal {
    return this.save({ ...goal, state: 'paused', pause });
  }

  private async startPlan(id: string): Promise<void> {
    const goal = this.deps.store.goal(id);
    if (this.disposed || goal?.state !== 'planning') return;
    const ctx = this.context(goal);
    if (!ctx) return void this.pause(goal, 'agent_missing');
    if (this.deps.jobs.busy(ctx.agent.id, ctx.channel.id, scopeOf(goal)))
      return this.later(() => void this.startPlan(id));
    const job = await this.deps.jobs.startWith(ctx.agent, ctx.channel, ctx.request, this.planPrompt(goal), where(goal));
    const current = this.deps.store.goal(id);
    if (!current) return;
    this.save({ ...current, planJobId: job.id });
    if (job.state !== 'running') this.onJob(job);
  }

  private async runNext(id: string): Promise<void> {
    const goal = this.deps.store.goal(id);
    if (this.disposed || goal?.state !== 'running') return;
    if (goal.steps.some((s) => s.state === 'running')) return;
    const limit = this.overBudget(goal);
    if (limit) return void this.pause(goal, limit);
    const step = goal.steps.find((s) => s.state === 'pending');
    if (!step) return; // nothing left: decided in onJob
    const ctx = this.context(goal);
    if (!ctx) return void this.pause(goal, 'agent_missing');
    if (this.deps.jobs.busy(ctx.agent.id, ctx.channel.id, scopeOf(goal)))
      return this.later(() => void this.runNext(id));
    const marked = this.save({
      ...goal,
      steps: goal.steps.map((s) => (s.id === step.id ? { ...s, state: 'running' } : s)),
    });
    const job = await this.deps.jobs.startWith(
      ctx.agent,
      ctx.channel,
      ctx.request,
      this.stepPrompt(marked, step),
      where(marked),
    );
    const current = this.deps.store.goal(id);
    if (!current) return;
    this.save({ ...current, steps: current.steps.map((s) => (s.id === step.id ? { ...s, jobId: job.id } : s)) });
    if (job.state !== 'running') this.onJob(job);
  }

  private overBudget(goal: Goal): GoalPause | undefined {
    if (goal.used.steps >= goal.budget.steps) return 'budget_steps';
    if (goal.used.ms >= goal.budget.minutes * 60_000) return 'budget_time';
    if (goal.budget.tokens !== undefined && goal.used.tokens >= goal.budget.tokens) return 'budget_tokens';
    return undefined;
  }

  /** A job ended (or failed to start); call after its answer message is stored. */
  onJob(job: Job): void {
    if (job.state === 'running' || job.state === 'attention') return;
    const goal = this.list().find((g) => g.planJobId === job.id || g.steps.some((s) => s.jobId === job.id));
    if (!goal || this.disposed) return;
    const tokens = job.usage.in + job.usage.out;
    const ms = Math.max(0, (job.ended ?? this.now()) - job.started);
    const used = { ...goal.used, tokens: goal.used.tokens + tokens, ms: goal.used.ms + ms };
    const answer =
      this.deps.store
        .messages(goal.channelId, { limit: 40 })
        .reverse()
        .find((m) => m.jobId === job.id)?.text ?? '';

    if (goal.planJobId === job.id) {
      if (goal.state !== 'planning') return;
      if (job.state !== 'done') return void this.pause({ ...goal, used }, 'job_failed');
      const steps = parsePlan(answer).map((text): GoalStep => ({ id: newId(), text, state: 'pending' }));
      if (steps.length === 0) return void this.pause({ ...goal, used }, 'no_plan');
      this.save({ ...goal, used, steps, state: 'review' });
      return;
    }

    const step = goal.steps.find((s) => s.jobId === job.id);
    if (step?.state !== 'running') return;
    const ok = job.state === 'done';
    const finished: Goal = {
      ...goal,
      used: { ...used, steps: used.steps + 1 },
      steps: goal.steps.map((s) => (s.id === step.id ? { ...s, state: ok ? 'done' : 'failed' } : s)),
    };
    if (goal.state !== 'running') return void this.save(finished);
    if (!ok) return void this.pause(finished, 'job_failed');
    const saved = this.save(finished);
    this.deps.onStep?.(saved, step, answer);
    void this.afterStep(saved.id, DONE_MARK.test(answer));
  }

  /** After a step: run the check, then finish, add a fix step, pause on the budget, or go on. */
  private async afterStep(id: string, saysDone: boolean): Promise<void> {
    let goal = this.deps.store.goal(id);
    if (goal?.state !== 'running') return;
    const agent = this.deps.store.agent(goal.agentId);
    let passed = true;
    if (goal.check && agent) {
      const started = this.now();
      const result = await this.deps.runCheck(goal.check, goal.worktree?.path ?? agent.folder);
      goal = this.deps.store.goal(id);
      if (!goal) return;
      passed = result.ok;
      goal = this.save({
        ...goal,
        lastCheck: { at: this.now(), ok: result.ok, output: result.output.slice(-4000) },
        used: { ...goal.used, ms: goal.used.ms + (this.now() - started) },
      });
      if (goal.state !== 'running') return;
    }
    const left = goal.steps.some((s) => s.state === 'pending');
    if (passed && (saysDone || !left)) {
      this.release(this.save({ ...goal, state: 'done', ended: this.now() }));
      return;
    }
    if (!left) {
      // The plan is done but the check still fails: one more step to fix it, within the budget.
      goal = this.save({
        ...goal,
        steps: [...goal.steps, { id: newId(), text: 'Make the done check pass', state: 'pending', fix: true }],
      });
    }
    void this.runNext(goal.id);
  }

  // ---------------------------------------------------------------- prompts

  private budgetLine(goal: Goal): string {
    const b = goal.budget;
    return `at most ${b.steps} steps and ${b.minutes} minutes${b.tokens ? `, ${b.tokens} tokens` : ''}`;
  }

  private planPrompt(goal: Goal): string {
    const me = this.deps.me();
    return [
      'GOAL MODE: PLAN',
      `${me.name || 'A person'} set a goal for you:`,
      `<goal>\n${goal.text}\n</goal>`,
      goal.check
        ? `Done check: Lonca itself runs \`${goal.check}\` in your folder after each step (exit code 0 means the goal is done) and tells you when it fails. Do not plan a step for running it.`
        : '',
      `Budget: ${this.budgetLine(goal)}.`,
      goal.worktree
        ? `The goal runs in its own git worktree (${goal.worktree.path}) on the branch ${goal.worktree.branch}; each step ends with a commit there.`
        : '',
      `Write the plan only; do not change anything yet. Reply with a numbered list of at most ${goal.budget.steps} steps, as few as the goal needs (a small change is one step), one line each, each small enough for one turn, in ${LANGUAGE_NAMES[me.language]}. No other text.`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private stepPrompt(goal: Goal, step: GoalStep): string {
    const me = this.deps.me();
    const index = goal.steps.findIndex((s) => s.id === step.id);
    const plan = goal.steps
      .map((s, i) => `${i + 1}. ${s.text}${s.state === 'done' ? ' (done)' : s.id === step.id ? ' (this step)' : ''}`)
      .join('\n');
    const comments = goal.comments.map((c) => {
      const on = c.stepId ? goal.steps.findIndex((s) => s.id === c.stepId) : -1;
      return `- ${on >= 0 ? `on step ${on + 1}` : 'on the plan'}: ${c.text}`;
    });
    const failed = goal.lastCheck && !goal.lastCheck.ok;
    return [
      `GOAL MODE: STEP ${index + 1} of ${goal.steps.length}`,
      `Goal: ${goal.text}`,
      `Plan:\n${plan}`,
      comments.length ? `Comments from ${me.name || 'the person'} on the plan:\n${comments.join('\n')}` : '',
      failed
        ? `The done check (${goal.check}) failed after the last step:\n\`\`\`\n${goal.lastCheck?.output.slice(-2000) ?? ''}\n\`\`\``
        : '',
      step.fix ? 'Do this step: make the done check pass.' : `Do only this step: ${step.text}`,
      goal.check ? 'Lonca runs the done check after this step; there is no need to run it yourself.' : '',
      goal.worktree
        ? `You work in a git worktree made for this goal (${goal.worktree.path}, branch ${goal.worktree.branch}), not in the main folder. Commit your changes there at the end of the step with a short message.`
        : '',
      'End with a short report: what you did and what is left. If the whole goal is complete, put GOAL_DONE alone on the last line.',
    ]
      .filter(Boolean)
      .join('\n\n');
  }
}
