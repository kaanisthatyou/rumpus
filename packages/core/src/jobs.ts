// Turns people's messages into jobs for agents and keeps every job's card current.
// One CLI session per (agent, channel), kept across jobs so the agent remembers the conversation.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Agent,
  AgentMode,
  Channel,
  CliInfo,
  CliKind,
  Job,
  JobStep,
  Language,
  Message,
  Quota,
  TranscriptEntry,
} from '@lonca/protocol';
import { openClaude } from './drivers/claude.js';
import { openCodex } from './drivers/codex.js';
import type { AgentSession, Attachment, DriverEvent, OpenSession } from './drivers/types.js';
import { newId } from './ids.js';
import { type Launch, resolveLaunch } from './proc.js';
import { type PromptLayers, systemPrompt, turnPrompt } from './prompts.js';
import type { WorkspaceStore } from './store.js';

export const DRIVERS: Partial<Record<CliKind, OpenSession>> = {
  'claude-code': openClaude,
  codex: openCodex,
};

export interface JobsDeps {
  store: WorkspaceStore;
  dir: string;
  clis: () => Promise<CliInfo[]>;
  me: () => { id: string; name: string; language: Language };
  emitJob: (job: Job) => void;
  emitMessage: (message: Message) => void;
  /** `key` is the CLI, or `<cli>:<account>` for an agent on an extra login. */
  emitQuota: (key: string, quota: Quota) => void;
  /** The environment of the agent's account (its CLI config folder), when it runs on an extra login. */
  accountEnv?(agent: Agent): Record<string, string> | undefined;
  drivers?: Partial<Record<CliKind, OpenSession>>;
  launch?: (path: string) => Launch;
  /** The records a message refers to: their notes for the prompt, their images as attachments. */
  refs?: (ids: string[]) => { notes: string[]; images: Attachment[] };
  /** The editable instruction layers (and the agent's project), read when a session starts. */
  layers?: (agent: Agent) => PromptLayers;
  /** How many memory sections the prompt carries (shown on the job card). */
  recalled?: () => number;
  /**
   * Whether a message may start (or steer) a job of an agent, and how: in a team workspace only the owner's app
   * runs an agent, others' requests are capped at the owner's limit and may wait for the owner's approval.
   */
  access?(agent: Agent, message: Message): { allow: boolean; mode?: AgentMode; approveFirst?: boolean };
  /** A job's state changed (started, waiting, ended): other members' apps show it. */
  publish?(job: Job): void;
  /** Lonca's MCP endpoint; each session gets its own token. */
  gateway?: {
    ready(): Promise<string>;
    issue(ctx: { agentId: string; channelId: string; slot?: string }): string;
    revoke(token: string): void;
  };
}

interface Live {
  agent: Agent;
  channelId: string;
  /** The session's place: the channel, or the channel plus a scope (a goal in its own worktree). */
  slot: string;
  session: AgentSession;
  job: Job | undefined;
  queue: string[];
  lastText: string;
  /** The instruction layers the session was started with; a change starts a new process (same conversation). */
  layers?: string;
  token?: string;
}

const MENTION = /(^|[^\w@])@([a-z0-9][a-z0-9-]{0,31})\b/g;
const EMIT_EVERY_MS = 120;

const slotOf = (channelId: string, scope?: string) => (scope ? `${channelId}#${scope}` : channelId);
/** The scope a handed-over part runs in: a session of its own, closed when the part ends. */
const PART = 'part-';
/** Parts one person's request may be split into. */
export const MAX_PARTS = 6;
/** How long after the handing job started a part may still start. */
const PART_WINDOW_MS = 2 * 60 * 60 * 1000;

export function mentions(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION)].map((m) => m[2] ?? ''))];
}

export class Jobs {
  private readonly live = new Map<string, Live>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  readonly quotas: Record<string, Quota> = {};

  constructor(private readonly deps: JobsDeps) {
    mkdirSync(join(deps.dir, 'jobs'), { recursive: true });
  }

  private key(agentId: string, channelId: string): string {
    return `${agentId}:${channelId}`;
  }

  /** Which agents a message is for: everyone in an agent's own channel goes to it; elsewhere @handle. */
  targets(message: Message, channel: Channel, agents: Agent[]): Agent[] {
    if (channel.kind === 'agent') return agents.filter((a) => a.id === channel.agentId);
    const handles = mentions(message.text);
    return agents.filter((a) => handles.includes(a.handle));
  }

  private readonly starting = new Map<string, Promise<void>>();

  /** Resolves once the jobs a message starts exist (used by the board to link a card to its job). */
  async whenStarted(messageId: string): Promise<void> {
    await this.starting.get(messageId);
  }

  onMessage(message: Message, channel: Channel): Promise<void> {
    const work = this.route(message, channel).finally(() => this.starting.delete(message.id));
    this.starting.set(message.id, work);
    return work;
  }

  /**
   * Whether an agent's message is a valid handed-over part: it continues a person's message that the handing agent
   * is (or was lately) working on, and that request is not itself a part, so work fans out one step at most.
   */
  isPart(message: Message): boolean {
    const h = message.handover;
    if (!h || message.author.kind !== 'agent' || message.author.id !== h.agentId) return false;
    const request = this.deps.store.message(h.requestId);
    if (request?.author.kind !== 'person' || request.handover) return false;
    return this.deps.store
      .jobsFor([h.requestId])
      .some((j) => j.agentId === h.agentId && j.started > this.now() - PART_WINDOW_MS);
  }

  private async route(message: Message, channel: Channel): Promise<void> {
    // Only a person's message starts work, or a part of a person's job that its agent handed over.
    const part = message.author.kind === 'agent' && this.isPart(message);
    if (message.author.kind !== 'person' && !part) return;
    if (part) {
      // A part names its agent with @, in any channel (also the handing agent's own one).
      const handles = mentions(message.text);
      const from = message.author.kind === 'agent' ? message.author.id : '';
      const target = this.deps.store.agents().find((a) => handles.includes(a.handle) && a.id !== from);
      if (!target) return;
      const rule = this.deps.access?.(target, message) ?? { allow: true };
      if (!rule.allow) return;
      const agent = rule.mode ? { ...target, mode: rule.mode } : target;
      if (rule.approveFirst) this.hold(agent, channel, message);
      else await this.start(agent, channel, message, undefined, { scope: `${PART}${message.id}` });
      return;
    }
    for (const target of this.targets(message, channel, this.deps.store.agents())) {
      const rule = this.deps.access?.(target, message) ?? { allow: true };
      if (!rule.allow) continue;
      const agent = rule.mode ? { ...target, mode: rule.mode } : target;
      const live = this.live.get(this.key(agent.id, channel.id));
      if (live?.job && (live.job.state === 'running' || live.job.state === 'attention')) {
        this.steerLive(live, message.text);
      } else if (rule.approveFirst) {
        this.hold(agent, channel, message);
      } else {
        await this.start(agent, channel, message);
      }
    }
  }

  private now(): number {
    return Date.now();
  }

  /** Jobs another member asked for that wait for the owner's yes before they start. */
  private readonly held = new Map<string, { agent: Agent; channel: Channel; message: Message }>();

  private hold(agent: Agent, channel: Channel, message: Message): void {
    const job: Job = {
      id: newId(),
      channelId: channel.id,
      agentId: agent.id,
      requestId: message.id,
      state: 'attention',
      steps: [],
      usage: { in: 0, cached: 0, out: 0 },
      approval: { id: 'start', label: 'start', arg: message.author.kind === 'person' ? message.author.name : '' },
      started: this.now(),
    };
    this.held.set(job.id, { agent, channel, message });
    this.save(job, true);
  }

  /** The last state each job was published with, so only changes go out. */
  private readonly published = new Map<string, string>();

  private save(job: Job, immediate = false): void {
    this.deps.store.saveJob(job);
    if (this.deps.publish && this.published.get(job.id) !== job.state) {
      this.published.set(job.id, job.state);
      this.deps.publish(job);
    }
    const emit = () => {
      this.timers.delete(job.id);
      this.deps.emitJob(job);
    };
    if (immediate) {
      clearTimeout(this.timers.get(job.id));
      emit();
    } else if (!this.timers.has(job.id)) {
      this.timers.set(job.id, setTimeout(emit, EMIT_EVERY_MS));
    }
  }

  private transcript(jobId: string, entry: TranscriptEntry): void {
    try {
      appendFileSync(join(this.deps.dir, 'jobs', `${jobId}.jsonl`), `${JSON.stringify(entry)}\n`);
    } catch {
      // the card still has the steps
    }
  }

  readTranscript(jobId: string): TranscriptEntry[] {
    const file = join(this.deps.dir, 'jobs', `${jobId}.jsonl`);
    if (!/^[\w-]+$/.test(jobId) || !existsSync(file)) return [];
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as TranscriptEntry);
  }

  private fail(job: Job, error: string): Job {
    const failed: Job = { ...job, state: 'failed', error, ended: this.now() };
    this.save(failed, true);
    this.transcript(job.id, { t: 'end', ok: false, error, at: this.now() });
    return failed;
  }

  /**
   * Starts a job with Lonca's own prompt (goal mode); `request` is the message its card hangs under. With a
   * `scope`, the job runs in a session of its own (and `folder`, when given, instead of the agent's folder).
   */
  startWith(
    agent: Agent,
    channel: Channel,
    request: Message,
    prompt: string,
    opts: { folder?: string; scope?: string } = {},
  ): Promise<Job> {
    return this.start(agent, channel, request, prompt, opts);
  }

  /** The job a session (an agent in a channel, or a scope of it) is working on now. */
  current(agentId: string, channelId: string, slot?: string): Job | undefined {
    const job = this.live.get(this.key(agentId, slot ?? channelId))?.job;
    return job?.state === 'running' || job?.state === 'attention' ? job : undefined;
  }

  /** Whether the agent is working (or waiting on a person) in that channel, or that scope of it, now. */
  busy(agentId: string, channelId: string, scope?: string): boolean {
    const job = this.live.get(this.key(agentId, slotOf(channelId, scope)))?.job;
    return job?.state === 'running' || job?.state === 'attention';
  }

  private async start(
    base: Agent,
    channel: Channel,
    request: Message,
    prompt?: string,
    opts: { folder?: string; scope?: string } = {},
    /** A job that already exists (one the owner just approved) continues instead of a new one. */
    existing?: Job,
  ): Promise<Job> {
    const agent = opts.folder ? { ...base, folder: opts.folder } : base;
    const slot = slotOf(channel.id, opts.scope);
    const job: Job = existing
      ? (({ approval: _a, ...rest }) => ({ ...rest, state: 'running' as const }))(existing)
      : {
          id: newId(),
          channelId: channel.id,
          agentId: agent.id,
          requestId: request.id,
          state: 'running',
          steps: [],
          usage: { in: 0, cached: 0, out: 0 },
          started: this.now(),
          ...((this.deps.recalled?.() ?? 0) > 0 ? { recalled: this.deps.recalled?.() } : {}),
        };
    this.save(job, true);

    const open = (this.deps.drivers ?? DRIVERS)[agent.kind];
    const cli = (await this.deps.clis()).find((c) => c.kind === agent.kind);
    if (!open) return this.fail(job, 'driver_missing');
    if (!cli?.path) return this.fail(job, 'cli_missing');
    if (!isDir(agent.folder)) return this.fail(job, 'folder_missing');

    const key = this.key(agent.id, slot);
    let live = this.live.get(key);
    const layerSet = this.deps.layers?.(base) ?? {};
    const layers = JSON.stringify(layerSet);
    if (
      live &&
      (live.layers !== layers ||
        live.agent.mode !== agent.mode ||
        live.agent.model !== agent.model ||
        live.agent.folder !== agent.folder ||
        live.agent.account !== agent.account ||
        live.agent.instructions !== agent.instructions)
    ) {
      this.close(live); // settings changed: start again, keeping the conversation
      live = undefined;
    }
    if (!live) {
      const me = this.deps.me();
      const resume = this.deps.store.session(agent.id, slot);
      const env = this.deps.accountEnv?.(agent);
      const mcpUrl = this.deps.gateway ? await this.deps.gateway.ready() : undefined;
      const token = mcpUrl
        ? this.deps.gateway?.issue({ agentId: agent.id, channelId: channel.id, ...(opts.scope ? { slot } : {}) })
        : undefined;
      const created: Live = {
        agent,
        channelId: channel.id,
        slot,
        session: undefined as unknown as AgentSession,
        job: undefined,
        queue: [],
        lastText: '',
      };
      created.session = open(
        {
          launch: (this.deps.launch ?? resolveLaunch)(cli.path),
          cwd: agent.folder,
          mode: agent.mode,
          ...(agent.model ? { model: agent.model } : {}),
          ...(resume ? { resume } : {}),
          systemPrompt: systemPrompt(agent, { user: me.name, language: me.language }, layerSet),
          ...(mcpUrl && token ? { mcp: { url: mcpUrl, token } } : {}),
          ...(env ? { env } : {}),
        },
        (e) => this.onEvent(created, e),
      );
      created.layers = layers;
      if (token) created.token = token;
      live = created;
      this.live.set(key, live);
    }
    live.agent = agent;
    live.job = job;
    live.lastText = '';
    live.queue = [];
    if (prompt !== undefined) {
      live.session.send(prompt);
      return job;
    }
    const context = this.contextFor(agent, channel, request);
    const refs = request.refs?.length && this.deps.refs ? this.deps.refs(request.refs) : { notes: [], images: [] };
    const notes = refs.notes.length ? `\n\n<references>\n${refs.notes.join('\n')}\n</references>` : '';
    live.session.send(turnPrompt(request, context, channel.name) + notes, refs.images);
    return job;
  }

  /** Messages since the agent last answered in this channel (others' words, marked as context). */
  private contextFor(agent: Agent, channel: Channel, request: Message): Message[] {
    const recent = this.deps.store.messages(channel.id, { before: request.created + 1, limit: 40 });
    const lastOwn = recent.map((m) => m.author.kind === 'agent' && m.author.id === agent.id).lastIndexOf(true);
    return recent.slice(lastOwn + 1).filter((m) => m.id !== request.id);
  }

  private steerLive(live: Live, text: string): void {
    const job = live.job;
    if (!job) return;
    const step: JobStep = { id: newId(), kind: 'steer', label: 'steer', arg: oneLine(text), at: this.now() };
    live.job = { ...job, steps: [...job.steps, step] };
    this.transcript(job.id, { t: 'steer', text, at: this.now() });
    if (live.session.steering === 'live') live.session.send(text);
    else live.queue.push(text);
    this.save(live.job, true);
  }

  steer(jobId: string, text: string): boolean {
    const live = [...this.live.values()].find((l) => l.job?.id === jobId);
    if (!live?.job || (live.job.state !== 'running' && live.job.state !== 'attention')) return false;
    this.steerLive(live, text);
    return true;
  }

  /** A person's answer to the approval a job waits on. */
  answer(jobId: string, allow: boolean): boolean {
    const held = this.held.get(jobId);
    if (held) {
      this.held.delete(jobId);
      const job = this.deps.store.job(jobId);
      if (!job) return false;
      if (allow) {
        const opts = held.message.handover ? { scope: `${PART}${held.message.id}` } : {};
        void this.start(held.agent, held.channel, held.message, undefined, opts, job);
      } else {
        const { approval: _a, ...rest } = job;
        this.save({ ...rest, state: 'stopped', error: 'denied_by_owner', ended: this.now() }, true);
      }
      return true;
    }
    const live = [...this.live.values()].find((l) => l.job?.id === jobId);
    const job = live?.job;
    if (!live || !job || job.state !== 'attention' || !job.approval || !live.session.answer) return false;
    live.session.answer(job.approval.id, allow);
    const { approval, ...rest } = job;
    live.job = { ...rest, state: 'running' };
    this.transcript(job.id, { t: 'notice', text: allow ? 'approved' : 'denied', at: this.now() });
    if (!allow) {
      live.job = {
        ...live.job,
        steps: [
          ...live.job.steps,
          {
            id: newId(),
            kind: 'denied',
            label: approval.label,
            ...(approval.arg ? { arg: approval.arg } : {}),
            ok: false,
            at: this.now(),
          },
        ],
      };
    }
    this.save(live.job, true);
    return true;
  }

  stop(jobId: string): boolean {
    const live = [...this.live.values()].find((l) => l.job?.id === jobId);
    if (!live?.job || (live.job.state !== 'running' && live.job.state !== 'attention')) return false;
    const job: Job = { ...live.job, state: 'stopped', ended: this.now() };
    live.job = job;
    live.queue = [];
    live.session.stop();
    this.transcript(job.id, { t: 'end', ok: false, error: 'stopped', at: this.now() });
    this.save(job, true);
    this.endPart(live);
    return true;
  }

  newSession(agentId: string, channelId: string): void {
    const key = this.key(agentId, channelId);
    const live = this.live.get(key);
    if (live?.job && live.job.state === 'running') this.stop(live.job.id);
    if (live) this.close(live);
    this.live.delete(key);
    this.deps.store.setSession(agentId, channelId, undefined);
  }

  /** Ends the session of a scope (a goal in its own worktree), so its process lets go of the folder. */
  closeScope(agentId: string, channelId: string, scope: string): void {
    const key = this.key(agentId, slotOf(channelId, scope));
    const live = this.live.get(key);
    if (!live) return;
    if (live.job?.state === 'running' || live.job?.state === 'attention') this.stop(live.job.id);
    this.close(live);
    this.live.delete(key);
  }

  /** Stops everything an agent runs (it was deleted or changed). */
  dropAgent(agentId: string): void {
    for (const [key, live] of this.live) {
      if (live.agent.id !== agentId) continue;
      if (live.job?.state === 'running') this.stop(live.job.id);
      this.close(live);
      this.live.delete(key);
    }
  }

  active(): Job[] {
    return [...this.live.values()]
      .map((l) => l.job)
      .filter((j): j is Job => j?.state === 'running' || j?.state === 'attention');
  }

  disposeAll(): void {
    for (const live of this.live.values()) this.close(live);
    this.live.clear();
  }

  private close(live: Live): void {
    live.session.dispose();
    if (live.token) this.deps.gateway?.revoke(live.token);
  }

  /** A progress note from the agent (Lonca's post_progress tool) on its current job. */
  note(agentId: string, channelId: string, text: string): boolean {
    const live = [...this.live.values()].find(
      (l) =>
        l.agent.id === agentId &&
        l.channelId === channelId &&
        (l.job?.state === 'running' || l.job?.state === 'attention'),
    );
    const job = live?.job;
    if (!live || !job || (job.state !== 'running' && job.state !== 'attention')) return false;
    const line = text.trim().split('\n')[0]?.slice(0, 200) ?? '';
    if (!line) return false;
    live.job = {
      ...job,
      steps: [...job.steps, { id: newId(), kind: 'notice', label: 'progress', arg: line, at: this.now() }],
    };
    this.transcript(job.id, { t: 'notice', text: line, at: this.now() });
    this.save(live.job, true);
    return true;
  }

  private onEvent(live: Live, e: DriverEvent): void {
    if (e.type === 'session') {
      this.deps.store.setSession(live.agent.id, live.slot, e.id);
      return;
    }
    if (e.type === 'quota') {
      const key = live.agent.account ? `${live.agent.kind}:${live.agent.account}` : live.agent.kind;
      this.quotas[key] = e.quota;
      this.deps.emitQuota(key, e.quota);
      return;
    }
    const job = live.job;
    if (!job || job.state === 'stopped' || job.state === 'done' || job.state === 'failed') return;
    const at = this.now();
    let next: Job = job;
    switch (e.type) {
      case 'delta': {
        const text = (job.preview ?? '') + e.text;
        next = { ...job, preview: text.length > 4000 ? text.slice(-4000) : text };
        break;
      }
      case 'text':
        live.lastText = e.text;
        next = { ...job, preview: undefined };
        this.transcript(job.id, { t: 'text', text: e.text, at });
        break;
      case 'tool':
        next = {
          ...job,
          steps: [...job.steps, { id: e.id, kind: 'tool', label: e.label, ...(e.arg ? { arg: e.arg } : {}), at }],
        };
        this.transcript(job.id, { t: 'tool', id: e.id, label: e.label, ...(e.arg ? { arg: e.arg } : {}), at });
        break;
      case 'tool_result':
        next = {
          ...job,
          steps: job.steps.map((s) => (s.id === e.id ? { ...s, ok: e.ok, preview: e.preview.slice(0, 300) } : s)),
        };
        this.transcript(job.id, { t: 'result', id: e.id, ok: e.ok, preview: e.preview, at });
        break;
      case 'denied':
        next = {
          ...job,
          steps: [
            ...job.steps,
            { id: newId(), kind: 'denied', label: e.label, ...(e.arg ? { arg: e.arg } : {}), ok: false, at },
          ],
        };
        this.transcript(job.id, { t: 'denied', label: e.label, ...(e.arg ? { arg: e.arg } : {}), at });
        break;
      case 'usage':
        next = {
          ...job,
          usage: {
            in: job.usage.in + (e.usage.in ?? 0),
            cached: job.usage.cached + (e.usage.cached ?? 0),
            out: job.usage.out + (e.usage.out ?? 0),
          },
        };
        break;
      case 'notice':
        next = {
          ...job,
          steps: [...job.steps, { id: newId(), kind: 'notice', label: e.code, ...(e.text ? { arg: e.text } : {}), at }],
        };
        this.transcript(job.id, { t: 'notice', text: e.code, at });
        break;
      case 'auth_failed':
        next = { ...job, error: 'auth_failed' };
        break;
      case 'approval':
        next = {
          ...job,
          state: 'attention',
          approval: {
            id: e.id,
            label: e.label,
            ...(e.arg ? { arg: e.arg } : {}),
            ...(e.detail ? { detail: e.detail } : {}),
          },
        };
        this.transcript(job.id, { t: 'notice', text: `approval: ${e.label} ${e.arg ?? ''}`.trim(), at });
        this.save(next, true);
        live.job = next;
        return;
      case 'end': {
        if (e.more) {
          live.job = { ...job, ...(e.usage ? { usage: addUsage(job.usage, e.usage) } : {}) };
          if (e.final) live.lastText = e.final;
          this.save(live.job, true);
          return;
        }
        if (live.queue.length > 0) {
          // Messages that arrived during the turn: the next turn of the same job.
          const queued = live.queue.splice(0).join('\n\n');
          live.job = { ...job, ...(e.usage ? { usage: addUsage(job.usage, e.usage) } : {}) };
          live.session.send(queued);
          this.save(live.job, true);
          return;
        }
        const { approval: _done, ...settled } = job;
        const ended: Job = {
          ...settled,
          state: e.ok ? 'done' : 'failed',
          preview: undefined,
          ended: at,
          ...(e.usage ? { usage: e.usage } : {}),
          ...(e.cost !== undefined ? { cost: e.cost } : {}),
          ...(!e.ok ? { error: job.error ?? e.error ?? 'failed' } : {}),
        };
        live.job = ended;
        this.transcript(job.id, { t: 'end', ok: e.ok, ...(e.error ? { error: e.error } : {}), at });
        this.save(ended, true);
        const answer = (e.final ?? live.lastText).trim();
        if (answer) this.postAnswer(live, ended, answer);
        this.endPart(live);
        return;
      }
      case 'exit': {
        const failed = this.fail(job, job.error ?? (e.stderr ? `exited: ${e.stderr.slice(-400)}` : 'exited'));
        live.job = failed;
        this.endPart(live);
        return;
      }
    }
    live.job = next;
    this.save(next);
  }

  /** A handed-over part's session ends with its job: the next part starts fresh. */
  private endPart(live: Live): void {
    if (!live.slot.includes(`#${PART}`)) return;
    setTimeout(() => {
      const key = this.key(live.agent.id, live.slot);
      if (this.live.get(key) !== live) return;
      this.close(live);
      this.live.delete(key);
      this.deps.store.setSession(live.agent.id, live.slot, undefined);
    }, 0);
  }

  private postAnswer(live: Live, job: Job, text: string): void {
    const message: Message = {
      id: newId(),
      channelId: live.channelId,
      author: { kind: 'agent', id: live.agent.id, name: live.agent.name },
      text,
      created: this.now(),
      jobId: job.id,
    };
    this.deps.store.commit({ type: 'message.posted', data: message });
    this.deps.emitMessage(message);
  }
}

function addUsage(a: { in: number; cached: number; out: number }, b: { in: number; cached: number; out: number }) {
  return { in: a.in + b.in, cached: a.cached + b.cached, out: a.out + b.out };
}

function oneLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 120 ? `${line.slice(0, 120)}…` : line;
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
