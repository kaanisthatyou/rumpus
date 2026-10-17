// Turns people's messages into jobs for agents and keeps every job's card current.
// One CLI session per (agent, channel), kept across jobs so the agent remembers the conversation.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Agent,
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
import type { AgentSession, DriverEvent, OpenSession } from './drivers/types.js';
import { newId } from './ids.js';
import { type Launch, resolveLaunch } from './proc.js';
import { systemPrompt, turnPrompt } from './prompts.js';
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
  emitQuota: (kind: CliKind, quota: Quota) => void;
  drivers?: Partial<Record<CliKind, OpenSession>>;
  launch?: (path: string) => Launch;
}

interface Live {
  agent: Agent;
  channelId: string;
  session: AgentSession;
  job: Job | undefined;
  queue: string[];
  lastText: string;
}

const MENTION = /(^|[^\w@])@([a-z0-9][a-z0-9-]{0,31})\b/g;
const EMIT_EVERY_MS = 120;

export function mentions(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION)].map((m) => m[2] ?? ''))];
}

export class Jobs {
  private readonly live = new Map<string, Live>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  readonly quotas: Partial<Record<CliKind, Quota>> = {};

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

  async onMessage(message: Message, channel: Channel): Promise<void> {
    if (message.author.kind !== 'person') return; // only a person's message starts work
    for (const agent of this.targets(message, channel, this.deps.store.agents())) {
      const live = this.live.get(this.key(agent.id, channel.id));
      if (live?.job && (live.job.state === 'running' || live.job.state === 'attention')) {
        this.steerLive(live, message.text);
      } else {
        await this.start(agent, channel, message);
      }
    }
  }

  private now(): number {
    return Date.now();
  }

  private save(job: Job, immediate = false): void {
    this.deps.store.saveJob(job);
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

  private async start(agent: Agent, channel: Channel, request: Message): Promise<void> {
    const job: Job = {
      id: newId(),
      channelId: channel.id,
      agentId: agent.id,
      requestId: request.id,
      state: 'running',
      steps: [],
      usage: { in: 0, cached: 0, out: 0 },
      started: this.now(),
    };
    this.save(job, true);

    const open = (this.deps.drivers ?? DRIVERS)[agent.kind];
    const cli = (await this.deps.clis()).find((c) => c.kind === agent.kind);
    if (!open) return void this.fail(job, 'driver_missing');
    if (!cli?.path) return void this.fail(job, 'cli_missing');
    if (!isDir(agent.folder)) return void this.fail(job, 'folder_missing');

    const key = this.key(agent.id, channel.id);
    let live = this.live.get(key);
    if (
      live &&
      (live.agent.mode !== agent.mode ||
        live.agent.model !== agent.model ||
        live.agent.folder !== agent.folder ||
        live.agent.instructions !== agent.instructions)
    ) {
      live.session.dispose(); // settings changed: start again, keeping the conversation
      live = undefined;
    }
    if (!live) {
      const me = this.deps.me();
      const resume = this.deps.store.session(agent.id, channel.id);
      const created: Live = {
        agent,
        channelId: channel.id,
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
          systemPrompt: systemPrompt(agent, { user: me.name, language: me.language }),
        },
        (e) => this.onEvent(created, e),
      );
      live = created;
      this.live.set(key, live);
    }
    live.agent = agent;
    live.job = job;
    live.lastText = '';
    live.queue = [];
    const context = this.contextFor(agent, channel, request);
    live.session.send(turnPrompt(request, context, channel.name));
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

  stop(jobId: string): boolean {
    const live = [...this.live.values()].find((l) => l.job?.id === jobId);
    if (!live?.job || (live.job.state !== 'running' && live.job.state !== 'attention')) return false;
    const job: Job = { ...live.job, state: 'stopped', ended: this.now() };
    live.job = job;
    live.queue = [];
    live.session.stop();
    this.transcript(job.id, { t: 'end', ok: false, error: 'stopped', at: this.now() });
    this.save(job, true);
    return true;
  }

  newSession(agentId: string, channelId: string): void {
    const key = this.key(agentId, channelId);
    const live = this.live.get(key);
    if (live?.job && live.job.state === 'running') this.stop(live.job.id);
    live?.session.dispose();
    this.live.delete(key);
    this.deps.store.setSession(agentId, channelId, undefined);
  }

  /** Stops everything an agent runs (it was deleted or changed). */
  dropAgent(agentId: string): void {
    for (const [key, live] of this.live) {
      if (live.agent.id !== agentId) continue;
      if (live.job?.state === 'running') this.stop(live.job.id);
      live.session.dispose();
      this.live.delete(key);
    }
  }

  active(): Job[] {
    return [...this.live.values()]
      .map((l) => l.job)
      .filter((j): j is Job => j?.state === 'running' || j?.state === 'attention');
  }

  disposeAll(): void {
    for (const live of this.live.values()) live.session.dispose();
    this.live.clear();
  }

  private onEvent(live: Live, e: DriverEvent): void {
    if (e.type === 'session') {
      this.deps.store.setSession(live.agent.id, live.channelId, e.id);
      return;
    }
    if (e.type === 'quota') {
      this.quotas[live.agent.kind] = e.quota;
      this.deps.emitQuota(live.agent.kind, e.quota);
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
        const ended: Job = {
          ...job,
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
        return;
      }
      case 'exit': {
        const failed = this.fail(job, job.error ?? (e.stderr ? `exited: ${e.stderr.slice(-400)}` : 'exited'));
        live.job = failed;
        return;
      }
    }
    live.job = next;
    this.save(next);
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
