// A race (PLAN.md 5.18): one task given to several of this computer's agents at once, each in a git worktree of
// its own on a branch of its own, so they cannot be in each other's way. Every contestant's job has its ordinary
// card; when a job ends its worktree is committed to its branch. The person compares what each one did and picks
// one: its branch is applied to the main folder as staged changes, not committed, and the worktrees go (the
// branches stay). Races are kept on this computer only; the jobs show to the other members like any job.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type Agent,
  BRAND,
  CoreError,
  type Job,
  type Language,
  type Message,
  type Race,
  type RaceInput,
} from '@lonca/protocol';
import { newId } from './ids.js';
import type { Jobs } from './jobs.js';
import type { Runner } from './proc.js';
import type { WorkspaceStore } from './store.js';

export const MIN_RACERS = 2;
export const MAX_RACERS = 4;

/** A race with what only this computer needs to know about it. */
interface Kept extends Race {
  /** The repository's top folder, the agents' folder inside it, and the commit the worktrees started from. */
  repo: string;
  prefix: string;
  base: string;
  /** The worktree of each entry, in the entries' order. */
  paths: string[];
}

export interface RacesDeps {
  store: WorkspaceStore;
  jobs: Pick<Jobs, 'startWith' | 'stop' | 'closeScope'>;
  runner: Runner;
  /** Where the races are kept (`<workspace>/races.json`) and where their worktrees go. */
  file: string;
  worktreesDir: string;
  me(): { id: string; name: string; language: Language };
  emitRace(race: Race): void;
  emitMessage(message: Message): void;
  now?(): number;
}

const scopeOf = (raceId: string, agentId: string) => `race-${raceId}-${agentId}`;
const over = (job: Job | undefined) => !job || (job.state !== 'running' && job.state !== 'attention');

export class Races {
  private races: Kept[] = [];
  /** Work on a race happens one thing after the other: two jobs ending at once must not both place first. */
  private readonly chains = new Map<string, Promise<void>>();

  constructor(private readonly deps: RacesDeps) {
    if (existsSync(deps.file)) {
      try {
        const data = JSON.parse(readFileSync(deps.file, 'utf8')) as { v?: number; races?: Kept[] };
        if (data.v === 1 && Array.isArray(data.races)) this.races = data.races;
      } catch {
        // a damaged file starts over; the branches are still in the repository
      }
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private git(cwd: string, args: string[], timeoutMs = 60_000) {
    return this.deps
      .runner('git', ['-C', cwd, ...args], {
        timeoutMs,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
      })
      .then((r) => ({
        ok: !r.failed && !r.timedOut && r.code === 0,
        code: r.code,
        out: r.stdout.trim(),
        all: `${r.stdout}\n${r.stderr}`.trim(),
      }));
  }

  private view({ repo: _r, prefix: _p, base: _b, paths: _w, ...race }: Kept): Race {
    return race;
  }

  private persist(race: Kept): Race {
    const at = this.races.findIndex((r) => r.id === race.id);
    if (at >= 0) this.races[at] = race;
    else this.races.push(race);
    // The latest races are enough: older ones are a branch name in the repository and a message in the channel.
    this.races = this.races.slice(-200);
    mkdirSync(dirname(this.deps.file), { recursive: true });
    writeFileSync(`${this.deps.file}.tmp`, JSON.stringify({ v: 1, races: this.races }, null, 2));
    renameSync(`${this.deps.file}.tmp`, this.deps.file);
    const view = this.view(race);
    this.deps.emitRace(view);
    return view;
  }

  list(): Race[] {
    return this.races.map((r) => this.view(r));
  }

  private kept(id: unknown): Kept {
    const race = typeof id === 'string' ? this.races.find((r) => r.id === id) : undefined;
    if (!race) throw new CoreError('not_found');
    return race;
  }

  /** Whether a job is a contestant's. */
  has(jobId: string): boolean {
    return this.races.some((r) => r.entries.some((e) => e.jobId === jobId));
  }

  /** One thing at a time per race. */
  private queue(raceId: string, work: () => Promise<void>): Promise<void> {
    const next = (this.chains.get(raceId) ?? Promise.resolve()).then(work, work);
    this.chains.set(
      raceId,
      next.catch(() => {}),
    );
    return next;
  }

  async create(input: RaceInput): Promise<Race> {
    const { store } = this.deps;
    const channel = typeof input?.channelId === 'string' ? store.channel(input.channelId) : undefined;
    if (!channel) throw new CoreError('not_found', 'channel');
    const task = typeof input.task === 'string' ? input.task.trim() : '';
    if (!task || task.length > 4000) throw new CoreError('invalid_race', 'task');
    const ids = [...new Set(Array.isArray(input.agentIds) ? input.agentIds.filter((x) => typeof x === 'string') : [])];
    const agents = ids.map((id) => store.agent(id)).filter((a): a is Agent => a !== undefined);
    if (agents.length !== ids.length || agents.length < MIN_RACERS || agents.length > MAX_RACERS)
      throw new CoreError('invalid_race', 'agents');

    // The race runs on the repository of the first agent's folder, from the commit it is on now.
    const folder = (agents[0] as Agent).folder;
    const where = await this.git(folder, ['rev-parse', '--show-toplevel', '--show-prefix'], 15_000);
    const [repo, prefix = ''] = where.out.split('\n').map((l) => l.trim());
    if (!where.ok || !repo) throw new CoreError('not_git');
    const head = await this.git(repo, ['rev-parse', '--verify', 'HEAD'], 15_000);
    if (!head.ok) throw new CoreError('not_git', 'no commit yet');

    const id = newId();
    const short = id.slice(-6).toLowerCase();
    const paths: string[] = [];
    const entries: Race['entries'] = [];
    for (const [n, agent] of agents.entries()) {
      const branch = `${BRAND.slug}/race-${short}-${agent.handle}`;
      const path = join(this.deps.worktreesDir, `race-${id}-${n + 1}`);
      const made = await this.git(repo, ['worktree', 'add', '-b', branch, path, head.out]);
      if (!made.ok) {
        for (const p of paths) await this.git(repo, ['worktree', 'remove', '--force', p]);
        throw new CoreError('worktree_failed', made.all.slice(-400));
      }
      paths.push(path);
      entries.push({ agentId: agent.id, branch });
    }

    const me = this.deps.me();
    const request: Message = {
      id: newId(),
      channelId: channel.id,
      author: { kind: 'person', id: me.id, name: me.name },
      text: `${me.language === 'tr' ? '/yarış' : '/race'} ${task}`,
      created: this.now(),
    };
    store.commit({ type: 'message.posted', data: request });
    this.deps.emitMessage(request);

    const race: Kept = {
      id,
      channelId: channel.id,
      requestId: request.id,
      task,
      entries,
      state: 'running',
      created: this.now(),
      repo,
      prefix,
      base: head.out,
      paths,
    };
    this.persist(race);
    for (const [n, agent] of agents.entries()) {
      const job = await this.deps.jobs.startWith(agent, channel, request, this.prompt(race, n, agents.length), {
        folder: join(paths[n] as string, prefix),
        scope: scopeOf(id, agent.id),
      });
      // A quick contestant may already be taken in while the next one starts: the id goes onto the latest state.
      await this.queue(id, async () => {
        const latest = this.kept(id);
        this.persist({ ...latest, entries: latest.entries.map((e, i) => (i === n ? { ...e, jobId: job.id } : e)) });
      });
    }
    // A job that could not even start has ended before its id was kept.
    void this.queue(id, () => this.settle(id));
    return this.view(this.kept(id));
  }

  private prompt(race: Kept, n: number, count: number): string {
    const entry = race.entries[n];
    return [
      race.task,
      '',
      `[${BRAND.name}] This task was given to ${count} agents at once, as a race: each works alone in a git worktree of its own, and the person will compare the results and keep one. Yours is ${join(race.paths[n] ?? '', race.prefix)} on the branch ${entry?.branch}. Work only in this folder. Do the whole task, then end with a short summary of what you changed and why. Do not commit and do not switch branches: ${BRAND.name} commits your work when you finish.`,
    ].join('\n');
  }

  /** A contestant's job changed state. */
  onJob(job: Job): void {
    const race = this.races.find((r) => r.entries.some((e) => e.jobId === job.id));
    if (race && over(job)) void this.queue(race.id, () => this.settle(race.id));
  }

  /** Takes in every contestant whose job has ended: its place, its work committed to its branch. */
  private async settle(id: string): Promise<void> {
    const found = this.races.find((r) => r.id === id);
    if (!found || found.state !== 'running') return;
    let race: Kept = found;
    for (const [n, entry] of race.entries.entries()) {
      if (entry.done || !entry.jobId) continue;
      const job = this.deps.store.job(entry.jobId);
      if (!over(job)) continue;
      this.deps.jobs.closeScope(entry.agentId, race.channelId, scopeOf(race.id, entry.agentId));
      const changed = await this.commit(race, n);
      // Committing takes a moment; the race may have been written to meanwhile.
      race = this.kept(id);
      const placed: number = race.entries.filter((e) => e.place !== undefined).length;
      race = {
        ...race,
        entries: race.entries.map((e, i) =>
          i === n
            ? {
                ...e,
                done: true,
                ...(changed ? { changed: true } : {}),
                ...(job?.state === 'done' ? { place: placed + 1 } : {}),
              }
            : e,
        ),
      };
      this.persist(race);
    }
    race = this.kept(id);
    if (race.state === 'running' && race.entries.every((e) => e.done))
      this.persist({ ...race, state: 'ready', ended: this.now() });
  }

  /** What a contestant left in its worktree, as one commit on its branch. Whether the branch has any work. */
  private async commit(race: Kept, n: number): Promise<boolean> {
    const path = race.paths[n];
    if (!path || !existsSync(path)) return false;
    await this.git(path, ['add', '-A']);
    const staged = await this.git(path, ['diff', '--cached', '--quiet']);
    if (staged.code === 1) {
      const agent = this.deps.store.agent(race.entries[n]?.agentId ?? '');
      const title = race.task.split('\n')[0]?.slice(0, 72) ?? '';
      // The person's hooks are for the person's commits; this one is the app's record on a branch of its own.
      await this.git(path, [
        '-c',
        `user.name=${agent?.name ?? BRAND.name}`,
        '-c',
        `user.email=${BRAND.slug}@localhost`,
        'commit',
        '-q',
        '--no-verify',
        '-m',
        `${title}\n\n${BRAND.name} race, ${agent?.name ?? 'agent'} (@${agent?.handle ?? ''})`,
      ]);
    }
    const head = await this.git(path, ['rev-parse', 'HEAD']);
    return head.ok && head.out !== race.base;
  }

  /** Stops the jobs still running; the race is ready to compare once they have ended. */
  stop(id: unknown): Race {
    const race = this.kept(id);
    if (race.state !== 'running') throw new CoreError('race_state');
    for (const e of race.entries) if (e.jobId && !e.done) this.deps.jobs.stop(e.jobId);
    void this.queue(race.id, () => this.settle(race.id));
    return this.view(race);
  }

  /** Ends every job and removes the worktrees (never by force: one with changes stays). The branches stay. */
  private async clear(race: Kept): Promise<Kept> {
    for (const e of race.entries) {
      if (e.jobId && !over(this.deps.store.job(e.jobId))) this.deps.jobs.stop(e.jobId);
      this.deps.jobs.closeScope(e.agentId, race.channelId, scopeOf(race.id, e.agentId));
    }
    const entries = [...race.entries];
    for (const [n, e] of entries.entries()) {
      const path = race.paths[n];
      if (e.removed || !path) continue;
      let r = await this.git(race.repo, ['worktree', 'remove', path]);
      if (!r.ok && !existsSync(path)) r = await this.git(race.repo, ['worktree', 'prune']);
      if (!r.ok) {
        // The CLI's process may still hold the folder for a moment.
        await new Promise((res) => setTimeout(res, 800));
        r = await this.git(race.repo, ['worktree', 'remove', path]);
      }
      if (r.ok) entries[n] = { ...e, removed: true };
    }
    return { ...race, entries };
  }

  /**
   * Keeps one contestant's work: its branch is applied to the main folder as staged changes (a squash, nothing
   * committed), then the race is cleared. A branch that does not apply cleanly leaves the main folder as it was.
   */
  async pick(id: unknown, agentId: unknown): Promise<Race> {
    const start = this.kept(id);
    let result: Race | undefined;
    await this.queue(start.id, async () => {
      let race = this.kept(id);
      if (race.state !== 'ready' && race.state !== 'running') throw new CoreError('race_state');
      const n = race.entries.findIndex((e) => e.agentId === agentId);
      const entry = race.entries[n];
      if (!entry?.done) throw new CoreError('race_state');
      if (entry.changed) {
        // With nothing staged before, whatever a failed attempt leaves staged is its own and can be dropped.
        const staged = await this.git(race.repo, ['diff', '--cached', '--quiet']);
        if (staged.code !== 0) throw new CoreError('race_dirty');
        const merged = await this.git(race.repo, ['merge', '--squash', entry.branch]);
        if (!merged.ok) {
          await this.git(race.repo, ['reset', '--merge']);
          throw new CoreError('race_conflict', merged.all.slice(-400));
        }
      }
      race = await this.clear(race);
      result = this.persist({ ...race, state: 'picked', winner: entry.agentId, ended: race.ended ?? this.now() });
    });
    return result as Race;
  }

  /** Ends a race without keeping anyone's work in the main folder. */
  async close(id: unknown): Promise<Race> {
    const start = this.kept(id);
    let result: Race | undefined;
    await this.queue(start.id, async () => {
      const race = this.kept(id);
      if (race.state === 'picked' || race.state === 'closed') throw new CoreError('race_state');
      const cleared = await this.clear(race);
      result = this.persist({ ...cleared, state: 'closed', ended: race.ended ?? this.now() });
    });
    return result as Race;
  }

  /** Races that ran when the app closed: their jobs are over, so they are taken in as they are. */
  recover(): void {
    for (const race of this.races) {
      if (race.state === 'running') void this.queue(race.id, () => this.settle(race.id));
    }
  }
}
