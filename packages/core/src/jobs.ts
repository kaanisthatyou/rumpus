// Turns people's messages into jobs for agents and keeps every job's card current.
// One CLI session per (agent, channel), kept across jobs so the agent remembers the conversation; an agent with
// fresh sessions (and a specialist) starts every job in a new one. An agent with a spare login moves to it while its
// own is out of quota; a job with nowhere to move waits for the quota to reset and then goes on. Writing on a finished
// job's card goes on in that job's conversation.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Agent,
  type AgentMode,
  BRAND,
  type Channel,
  type CliInfo,
  type CliKind,
  CoreError,
  type Decision,
  FRESH_HISTORY,
  type Job,
  type JobChanges,
  type JobStep,
  type Language,
  MESSAGE_IMAGES_MAX,
  type Message,
  type MessageImage,
  type Quota,
  REPORT_DECISIONS_MAX,
  splitResult,
  type TranscriptEntry,
} from '@lonca/protocol';
import { openClaude } from './drivers/claude.js';
import { openCodex } from './drivers/codex.js';
import type { AgentSession, Attachment, DriverEvent, OpenSession } from './drivers/types.js';
import { newId } from './ids.js';
import { type Launch, resolveLaunch } from './proc.js';
import { type PromptLayers, systemPrompt, turnPrompt } from './prompts.js';
import type { Snapshots } from './snapshots.js';
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
  /** A message taken back (a note the agent wrote while working that turned out to be its answer). */
  emitDeleted?: (message: { id: string; channelId: string }) => void;
  /** `key` is the CLI, or `<cli>:<account>` for an agent on an extra login. */
  emitQuota: (key: string, quota: Quota) => void;
  /** The environment of the agent's account (its CLI config folder), when it runs on an extra login. */
  accountEnv?(agent: Agent): Record<string, string> | undefined;
  /** Whether this computer still has the extra login (an agent's spare may have been removed since). */
  hasAccount?(id: string): boolean;
  drivers?: Partial<Record<CliKind, OpenSession>>;
  launch?: (path: string) => Launch;
  /** The records a message refers to: their notes for the prompt, their images as attachments. */
  refs?: (ids: string[]) => { notes: string[]; images: Attachment[] };
  /** The report a message answers (PLAN.md 5.21): its text for the prompt, its images as attachments. */
  citation?: (request: Message) => { note: string; images: Attachment[] } | undefined;
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
  /** The connector tools an agent's session gets; a change starts its CLI again (same conversation). */
  toolset?(agent: Agent): string;
  /** Remembers the agent's folder before and after a job, where it is a git repository (what changed, undo). */
  snapshots?: Snapshots;
  /** Rumpus's MCP endpoint; each session gets its own token. */
  gateway?: {
    ready(): Promise<string>;
    issue(ctx: { agentId: string; channelId: string; slot?: string }): string;
    revoke(token: string): void;
  };
}

/** Told to an agent answering in a report channel (PLAN.md 5.21): its answer is shown as a report card. */
export const REPORT_HINT = `[${BRAND.name}] This is the workspace's reports: your answer is shown as a report card with its date. Start it with a short "# Title" line, then the findings; keep it a report, not a chat reply. Attach screenshots, diagrams or designs you made with attach_image; they are shown inside the card. A choice that is the person's to make (spending, publishing, a direction) goes in ask_decision, not in the text: they answer it from the card or leave it to you.`;

interface Live {
  agent: Agent;
  channelId: string;
  /** The session's place: the channel, or the channel plus a scope (a goal in its own worktree). */
  slot: string;
  session: AgentSession;
  job: Job | undefined;
  queue: string[];
  lastText: string;
  /** Text the agent wrote that is not in the channel yet: it goes there once a tool call follows it. */
  unposted?: string;
  /** The last note posted while the job ran, in case the answer turns out to be the same text. */
  posted?: { id: string; text: string };
  /** The instruction layers the session was started with; a change starts a new process (same conversation). */
  layers?: string;
  toolset?: string;
  token?: string;
  /** Running on the agent's spare login: its session is not kept (another login cannot resume it). */
  spare?: boolean;
  /** What started the current job, to start it again on the spare login when this one runs out of quota. */
  again?: {
    base: Agent;
    channel: Channel;
    request: Message;
    prompt?: string;
    opts: StartOpts;
  };
}

/** Where a job runs; `follow`: it goes on in an earlier job's conversation (written on that job's card). */
interface StartOpts {
  folder?: string;
  scope?: string;
  follow?: boolean;
}

/** A connector call waiting for a person (asked by the gateway, shown on the job card like a CLI's approval). */
interface Ask {
  id: string;
  label: string;
  arg?: string;
  detail?: string;
  resolve(allow: boolean): void;
}

/** Approval ids of gateway asks; the CLI's own ids never start with it. */
const ASK = 'lonca-ask-';
/** How long a connector call waits for a person before it counts as denied. */
const ASK_MS = 10 * 60_000;

const MENTION = /(^|[^\w@])@([a-z0-9][a-z0-9-]{0,31})\b/g;
const EMIT_EVERY_MS = 120;

const slotOf = (channelId: string, scope?: string) => (scope ? `${channelId}#${scope}` : channelId);
/** The scope a handed-over part runs in: a session of its own, closed when the part ends. */
const PART = 'part-';
/** The scope a specialist's job runs in: every job a fresh session, so only its playbook and lessons carry over. */
const SPEC = 'spec-';
/** How long a login counts as out of quota after a job hit its limit, when the CLI did not say when it resets. */
const LIMIT_HOLD_MS = 60 * 60_000;
/** How the CLIs word a job that stopped on the subscription's limit. */
const LIMIT_TEXT = /usage limit|hit your (?:usage )?limit|limit reached|out of (?:extra )?usage|rate[ _-]?limit/i;
/** How long after a quota resets a waiting job starts again (the CLI's clock and ours may differ a little). */
const WAIT_MARGIN_MS = 2 * 60_000;
/** How many times one job waits for a quota to reset before it fails. */
const MAX_WAITS = 3;
/** The longest a timer can be set for. */
const MAX_TIMER_MS = 2 ** 31 - 1;
/** How much of a specialist's budget may pass before it is told to wrap up. */
const BUDGET_SOFT = 0.75;
/** Parts one person's request may be split into. */
export const MAX_PARTS = 6;
/** How long after the handing job started a part may still start. */
const PART_WINDOW_MS = 2 * 60 * 60 * 1000;
/**
 * Turns the CLI may start on its own for one person's request, when background commands the agent started end
 * (PLAN.md 5.22). Past it the session stops: an agent cannot keep itself going with commands that wake it.
 */
export const MAX_WAKES = 8;

export function mentions(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION)].map((m) => m[2] ?? ''))];
}

/** Agents whose every job runs in a session of its own. */
const ownSessions = (agent: Agent) => Boolean(agent.specialty || agent.fresh);

const quotaKey = (kind: CliKind, account?: string) => (account ? `${kind}:${account}` : kind);

/** When the latest of a quota's windows resets (ms), if the CLI said. */
function resetsAt(quota: Quota | undefined): number | undefined {
  const at = Math.max(0, ...Object.values(quota?.windows ?? {}).map((w) => (w.resets ?? 0) * 1000));
  return at > 0 ? at : undefined;
}

export class Jobs {
  private readonly live = new Map<string, Live>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  readonly quotas: Record<string, Quota> = {};
  /** Logins out of quota (`quotaKey`) until then (ms), from jobs that stopped on the limit. */
  private readonly limited = new Map<string, number>();
  /** Jobs already moved to a spare login once. */
  private readonly moved = new Set<string>();
  /** Jobs waiting for their login's quota to reset, and when each starts again. */
  private readonly waits = new Map<string, NodeJS.Timeout>();
  /** How many times each job has waited for a quota. */
  private readonly waited = new Map<string, number>();
  /** Messages for a job that came while it waited: sent along when it starts again. */
  private readonly meanwhile = new Map<string, string[]>();
  /** Turns the CLI started on its own, by the request they go on with. */
  private readonly wakes = new Map<string, number>();

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

  /**
   * A message that may start work. `follow`: the job whose card the box pointed at (Kaan, 2026-11-19): its agent
   * goes on in that job's conversation instead of a new session, unless the message names only other agents.
   */
  onMessage(message: Message, channel: Channel, follow?: string): Promise<void> {
    const work = this.route(message, channel, follow).finally(() => this.starting.delete(message.id));
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

  private async route(message: Message, channel: Channel, follow?: string): Promise<void> {
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
      else await this.start(agent, channel, message, undefined, this.scopeFor(agent, message));
      return;
    }
    const agents = this.deps.store.agents();
    const targets = this.targets(message, channel, agents);
    const earlier = follow ? this.deps.store.job(follow) : undefined;
    const goesOn =
      earlier?.channelId === channel.id &&
      !this.deps.store.message(earlier.requestId)?.handover &&
      (targets.length === 0 || targets.some((a) => a.id === earlier.agentId))
        ? agents.find((a) => a.id === earlier.agentId)
        : undefined;
    if (earlier && goesOn) {
      // Not allowed to go on there (an approval first, a part's ended conversation): a message like any other.
      const went = this.steer(earlier.id, message.text)
        ? true
        : await this.follow(earlier.id, message, channel).then(
            () => true,
            () => false,
          );
      if (went) {
        for (const target of targets) if (target.id !== goesOn.id) await this.routeTo(target, message, channel);
        return;
      }
      if (!targets.some((a) => a.id === goesOn.id)) targets.push(goesOn);
    }
    for (const target of targets) await this.routeTo(target, message, channel);
  }

  /** A person's message to one agent: steers its running job in the channel, or starts one (held for approval). */
  private async routeTo(target: Agent, message: Message, channel: Channel): Promise<void> {
    const rule = this.deps.access?.(target, message) ?? { allow: true };
    if (!rule.allow) return;
    const agent = rule.mode ? { ...target, mode: rule.mode } : target;
    // A specialist's jobs each run in a session of their own; a message to one that is working steers that job.
    const live = ownSessions(agent)
      ? [...this.live.values()].find(
          (l) =>
            l.agent.id === agent.id &&
            l.slot.startsWith(`${channel.id}#${SPEC}`) &&
            (l.job?.state === 'running' || l.job?.state === 'attention'),
        )
      : this.live.get(this.key(agent.id, channel.id));
    if (live?.job && (live.job.state === 'running' || live.job.state === 'attention')) {
      this.steerLive(live, message.text);
    } else if (rule.approveFirst) {
      this.hold(agent, channel, message);
    } else {
      await this.start(agent, channel, message, undefined, this.scopeFor(agent, message));
    }
  }

  /** Where a job runs: a handed-over part and a specialist's job each get a session of their own. */
  private scopeFor(agent: Agent, message: Message): { scope?: string } {
    if (message.handover) return { scope: `${PART}${message.id}` };
    return ownSessions(agent) ? { scope: `${SPEC}${message.id}` } : {};
  }

  private now(): number {
    return Date.now();
  }

  /** Whose request a job is: the person who wrote it, or for a handed-over part the person it continues. */
  private askedBy(message: Message): { by?: string } {
    if (message.author.kind === 'person') return { by: message.author.id };
    const request = message.handover ? this.deps.store.message(message.handover.requestId) : undefined;
    return request?.author.kind === 'person' ? { by: request.author.id } : {};
  }

  /** Jobs another member asked for that wait for the owner's yes before they start. */
  private readonly held = new Map<string, { agent: Agent; channel: Channel; message: Message }>();

  private hold(agent: Agent, channel: Channel, message: Message): void {
    const job: Job = {
      id: newId(),
      channelId: channel.id,
      agentId: agent.id,
      requestId: message.id,
      ...this.askedBy(message),
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
    if (job.state !== 'running' && job.state !== 'attention') {
      this.dropAsks(job.id);
      this.clearBudget(job.id);
    }
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
   * Starts a job with Rumpus's own prompt (goal mode); `request` is the message its card hangs under. With a
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

  /** Whether a login is out of quota now: the CLI said so (a rejected rate-limit event), or a job hit the limit. */
  outOfQuota(kind: CliKind, account?: string): boolean {
    const key = quotaKey(kind, account);
    const now = this.now();
    if ((this.limited.get(key) ?? 0) > now) return true;
    const quota = this.quotas[key];
    if (quota?.status !== 'rejected') return false;
    const resets = resetsAt(quota);
    return resets ? resets > now : now - quota.at < LIMIT_HOLD_MS;
  }

  /** The agent on the login its job runs on: its spare while its own is out of quota and the spare is not. */
  private onLogin(agent: Agent): Agent {
    if (agent.spare === undefined || !this.outOfQuota(agent.kind, agent.account)) return agent;
    if (agent.spare && !this.deps.hasAccount?.(agent.spare)) return agent;
    if (this.outOfQuota(agent.kind, agent.spare || undefined)) return agent;
    const { account: _own, ...rest } = agent;
    return agent.spare ? { ...rest, account: agent.spare } : rest;
  }

  private async start(
    base: Agent,
    channel: Channel,
    request: Message,
    prompt?: string,
    opts: StartOpts = {},
    /** A job that already exists (one the owner just approved) continues instead of a new one. */
    existing?: Job,
  ): Promise<Job> {
    const agent = this.onLogin(opts.folder ? { ...base, folder: opts.folder } : base);
    const spare = (agent.account ?? '') !== (base.account ?? '');
    const slot = slotOf(channel.id, opts.scope);
    const job: Job = existing
      ? (({ approval: _a, ...rest }) => ({ ...rest, state: 'running' as const }))(existing)
      : {
          id: newId(),
          channelId: channel.id,
          agentId: agent.id,
          requestId: request.id,
          ...this.askedBy(request),
          state: 'running',
          steps: [],
          usage: { in: 0, cached: 0, out: 0 },
          started: this.now(),
          ...((this.deps.recalled?.() ?? 0) > 0 ? { recalled: this.deps.recalled?.() } : {}),
          ...(agent.specialty?.budget ? { budget: agent.specialty.budget } : {}),
        };
    this.save(job, true);

    const open = (this.deps.drivers ?? DRIVERS)[agent.kind];
    const cli = (await this.deps.clis()).find((c) => c.kind === agent.kind);
    if (!open) return this.fail(job, 'driver_missing');
    if (!cli?.path) return this.fail(job, 'cli_missing');
    if (!isDir(agent.folder)) return this.fail(job, 'folder_missing');
    // The folder as it is before the agent's first step. It is taken while the CLI starts; the agent gets its
    // request only once it is there.
    const taken = this.deps.snapshots?.before(job.id, agent.folder).catch(() => {});

    const key = this.key(agent.id, slot);
    let live = this.live.get(key);
    let resumed = false;
    const layerSet = this.deps.layers?.(base) ?? {};
    const layers = JSON.stringify(layerSet);
    const toolset = this.deps.toolset?.(base) ?? '';
    if (
      live &&
      (live.layers !== layers ||
        (live.toolset ?? '') !== toolset ||
        live.agent.mode !== agent.mode ||
        live.agent.model !== agent.model ||
        live.agent.folder !== agent.folder ||
        live.agent.account !== agent.account ||
        live.agent.fresh !== agent.fresh ||
        live.agent.instructions !== agent.instructions ||
        (live.agent.traits ?? []).join() !== (agent.traits ?? []).join() ||
        JSON.stringify(live.agent.specialty) !== JSON.stringify(agent.specialty))
    ) {
      this.close(live); // settings changed: start again, keeping the conversation
      live = undefined;
    }
    if (!live) {
      const me = this.deps.me();
      const resume = spare ? undefined : this.deps.store.session(agent.id, slot);
      resumed = resume !== undefined;
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
        ...(spare ? { spare: true } : {}),
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
      created.toolset = toolset;
      if (token) created.token = token;
      live = created;
      this.live.set(key, live);
    }
    live.agent = agent;
    live.job = job;
    live.lastText = '';
    live.unposted = undefined;
    live.posted = undefined;
    live.queue = [];
    live.again = { base, channel, request, ...(prompt !== undefined ? { prompt } : {}), opts };
    this.watchBudget(job);
    if (spare && !existing) this.mark(live, 'spare');
    if (opts.follow && resumed && !existing) this.mark(live, 'follow');
    // A job moved from a login that ran out of quota, or one that waited for it: the first try may have left work
    // behind.
    const held = this.meanwhile.get(job.id) ?? [];
    this.meanwhile.delete(job.id);
    const retried =
      (this.waited.has(job.id)
        ? `\n\n[${BRAND.name}] An earlier try at this request stopped at the usage limit and waited for the quota to reset. Files may already be partly changed: look before redoing work.`
        : this.moved.has(job.id)
          ? `\n\n[${BRAND.name}] An earlier try at this request on another login stopped at that login's usage limit. Files may already be partly changed: look before redoing work.`
          : '') +
      (held.length > 0
        ? `\n\n[${BRAND.name}] Messages about this request that came while it waited:\n\n${held.join('\n\n')}`
        : '');
    await taken;
    // Stopped while the snapshot was taken: there is nothing to send.
    if (live.job?.id !== job.id || live.job.state !== 'running') return live.job ?? job;
    if (prompt !== undefined) {
      live.session.send(prompt + retried);
      return job;
    }
    // A specialist (and an agent with fresh sessions) reads the channel's latest messages, whoever wrote them; a
    // specialist always gets its own references. A job that goes on in an earlier job's conversation already has it.
    const history =
      opts.follow && resumed && ownSessions(agent)
        ? 0
        : (agent.specialty?.history ?? (agent.fresh ? FRESH_HISTORY : undefined));
    const context =
      history === undefined
        ? this.contextFor(agent, channel, request)
        : history === 0
          ? []
          : this.deps.store
              .messages(channel.id, { before: request.created + 1, limit: history })
              .filter((m) => m.id !== request.id && !m.nudge);
    const refIds = [...new Set([...(agent.specialty?.refs ?? []), ...(request.refs ?? [])])];
    const refs = refIds.length && this.deps.refs ? this.deps.refs(refIds) : { notes: [], images: [] };
    const notes = refs.notes.length ? `\n\n<references>\n${refs.notes.join('\n')}\n</references>` : '';
    const cited = request.cite ? this.deps.citation?.(request) : undefined;
    const report = channel.reports ? `\n\n${REPORT_HINT}` : '';
    live.session.send(
      turnPrompt(request, context, channel.name, history || 20) +
        notes +
        (cited ? `\n\n${cited.note}` : '') +
        report +
        retried,
      [...refs.images, ...(cited?.images ?? [])],
    );
    return job;
  }

  // ---------------------------------------------------------------- a specialist's budget

  private readonly budgets = new Map<string, NodeJS.Timeout[]>();

  private watchBudget(job: Job): void {
    if (!job.budget) return;
    const ms = job.budget.minutes * 60_000;
    const timers = [
      setTimeout(() => this.warnBudget(job.id), ms * BUDGET_SOFT),
      setTimeout(() => this.overBudget(job.id), ms),
    ];
    for (const t of timers) t.unref?.();
    this.clearBudget(job.id);
    this.budgets.set(job.id, timers);
  }

  private clearBudget(jobId: string): void {
    for (const t of this.budgets.get(jobId) ?? []) clearTimeout(t);
    this.budgets.delete(jobId);
  }

  /** Tells the agent, once, that its budget is nearly used: it should deliver what it has. */
  private warnBudget(jobId: string): void {
    const live = [...this.live.values()].find((l) => l.job?.id === jobId);
    const job = live?.job;
    if (!live || !job?.budget || job.budget.warned || (job.state !== 'running' && job.state !== 'attention')) return;
    const at = this.now();
    live.job = {
      ...job,
      budget: { ...job.budget, warned: true },
      steps: [...job.steps, { id: newId(), kind: 'notice', label: 'budget', at }],
    };
    this.transcript(job.id, { t: 'notice', text: 'budget nearly used', at });
    const text = `[${BRAND.name}] The budget for this job is nearly used up. Stop improving: deliver what you have now and end your turn${live.agent.specialty?.result ? ' with the RESULT line' : ''}.`;
    if (live.session.steering === 'live') live.session.send(text);
    else live.queue.push(text);
    this.save(live.job, true);
  }

  /** Past the budget the job is stopped; while it waits on a person the clock does not run out. */
  private overBudget(jobId: string): void {
    const live = [...this.live.values()].find((l) => l.job?.id === jobId);
    const job = live?.job;
    if (!job) return;
    if (job.state === 'attention') {
      const again = setTimeout(() => this.overBudget(jobId), 60_000);
      again.unref?.();
      this.budgets.set(jobId, [again]);
      return;
    }
    if (job.state === 'running') this.stop(jobId, 'over_budget');
  }

  /** Tokens (new input and output) against the budget, after every usage report. */
  private checkTokens(job: Job): void {
    const limit = job.budget?.tokens;
    if (!limit) return;
    const spent = job.usage.in + job.usage.out;
    if (spent >= limit) this.overBudget(job.id);
    else if (spent >= limit * BUDGET_SOFT) this.warnBudget(job.id);
  }

  /** Messages since the agent last answered in this channel (others' words, marked as context). */
  private contextFor(agent: Agent, channel: Channel, request: Message): Message[] {
    // Reminders (PLAN.md 5.23) are not part of the conversation: they neither count as the agent's last word nor
    // reach it as context.
    const recent = this.deps.store
      .messages(channel.id, { before: request.created + 1, limit: 40 })
      .filter((m) => !m.nudge);
    const lastOwn = recent.map((m) => m.author.kind === 'agent' && m.author.id === agent.id).lastIndexOf(true);
    return recent.slice(lastOwn + 1).filter((m) => m.id !== request.id);
  }

  private steerLive(live: Live, text: string): void {
    const job = live.job;
    if (!job) return;
    const step: JobStep = { id: newId(), kind: 'steer', label: 'steer', arg: oneLine(text), at: this.now() };
    live.job = { ...job, steps: [...job.steps, step] };
    this.transcript(job.id, { t: 'steer', text, at: this.now() });
    if (this.waits.has(job.id)) this.meanwhile.set(job.id, [...(this.meanwhile.get(job.id) ?? []), text]);
    else if (live.session.steering === 'live') live.session.send(text);
    else live.queue.push(text);
    this.save(live.job, true);
  }

  steer(jobId: string, text: string): boolean {
    const live = [...this.live.values()].find((l) => l.job?.id === jobId);
    if (!live?.job || (live.job.state !== 'running' && live.job.state !== 'attention')) return false;
    this.steerLive(live, text);
    return true;
  }

  /**
   * A person wrote on a finished job's card: the agent goes on in that job's conversation, as a new job under
   * `request`. An agent with a session per job resumes the earlier job's session (kept when it ended); one with a
   * session per channel goes on in that one, and a message while it works there steers the running job.
   */
  async follow(jobId: string, request: Message, channel: Channel): Promise<Job | undefined> {
    const earlier = this.deps.store.job(jobId);
    const target = earlier ? this.deps.store.agents().find((a) => a.id === earlier.agentId) : undefined;
    if (!earlier || !target || earlier.channelId !== channel.id) throw new CoreError('not_found');
    // A handed-over part's session ends with it: there is nothing to go on in.
    if (this.deps.store.message(earlier.requestId)?.handover) throw new CoreError('not_found');
    const rule = this.deps.access?.(target, request) ?? { allow: true };
    if (!rule.allow || rule.approveFirst) throw new CoreError('not_allowed');
    const agent = rule.mode ? { ...target, mode: rule.mode } : target;
    if (!ownSessions(agent)) {
      const live = this.live.get(this.key(agent.id, channel.id));
      if (live?.job && (live.job.state === 'running' || live.job.state === 'attention')) {
        this.steerLive(live, request.text);
        return live.job;
      }
      return this.start(agent, channel, request, undefined, { follow: true });
    }
    const scope = `${SPEC}${request.id}`;
    const session = this.deps.store.session(agent.id, slotOf(channel.id, `${SPEC}${earlier.requestId}`));
    if (session) this.deps.store.setSession(agent.id, slotOf(channel.id, scope), session);
    return this.start(agent, channel, request, undefined, { scope, follow: true });
  }

  /** A person's answer to the approval a job waits on. */
  answer(jobId: string, allow: boolean): boolean {
    const held = this.held.get(jobId);
    if (held) {
      this.held.delete(jobId);
      const job = this.deps.store.job(jobId);
      if (!job) return false;
      if (allow) {
        const opts = this.scopeFor(held.agent, held.message);
        void this.start(held.agent, held.channel, held.message, undefined, opts, job);
      } else {
        const { approval: _a, ...rest } = job;
        this.save({ ...rest, state: 'stopped', error: 'denied_by_owner', ended: this.now() }, true);
      }
      return true;
    }
    const live = [...this.live.values()].find((l) => l.job?.id === jobId);
    const job = live?.job;
    if (job?.approval?.id.startsWith(ASK)) return this.settleAsk(job.id, job.approval.id, allow);
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
    this.showAsk(live);
    return true;
  }

  /**
   * A connector call that needs a person: it waits on the job's card (one at a time, after any approval the CLI
   * asked for) and resolves false when denied, unanswered in time, or when the job ends.
   */
  ask(agentId: string, slot: string, what: { label: string; arg?: string; detail?: string }): Promise<boolean> {
    const live = this.live.get(this.key(agentId, slot));
    const job = live?.job;
    if (!live || !job || (job.state !== 'running' && job.state !== 'attention')) return Promise.resolve(false);
    return new Promise((resolve) => {
      const id = `${ASK}${newId()}`;
      const timer = setTimeout(() => this.settleAsk(job.id, id, false), ASK_MS);
      timer.unref?.();
      const queue = this.asks.get(job.id) ?? [];
      queue.push({
        id,
        ...what,
        resolve: (allow) => {
          clearTimeout(timer);
          resolve(allow);
        },
      });
      this.asks.set(job.id, queue);
      this.showAsk(live);
    });
  }

  private readonly asks = new Map<string, Ask[]>();

  private showAsk(live: Live): void {
    const job = live.job;
    const first = job ? this.asks.get(job.id)?.[0] : undefined;
    if (!job || !first || job.state !== 'running') return;
    live.job = {
      ...job,
      state: 'attention',
      approval: {
        id: first.id,
        label: first.label,
        ...(first.arg ? { arg: first.arg } : {}),
        ...(first.detail ? { detail: first.detail } : {}),
      },
    };
    this.transcript(job.id, {
      t: 'notice',
      text: `approval: ${first.label} ${first.arg ?? ''}`.trim(),
      at: this.now(),
    });
    this.save(live.job, true);
  }

  private settleAsk(jobId: string, askId: string, allow: boolean): boolean {
    const queue = this.asks.get(jobId);
    const at = queue?.findIndex((a) => a.id === askId) ?? -1;
    const ask = queue?.[at];
    if (!queue || !ask) return false;
    queue.splice(at, 1);
    if (queue.length === 0) this.asks.delete(jobId);
    ask.resolve(allow);
    const live = [...this.live.values()].find((l) => l.job?.id === jobId);
    const job = live?.job;
    if (live && job?.approval?.id === askId) {
      const { approval: _a, ...rest } = job;
      const denied = {
        id: newId(),
        kind: 'denied' as const,
        label: ask.label,
        ...(ask.arg ? { arg: ask.arg } : {}),
        ok: false,
        at: this.now(),
      };
      live.job = { ...rest, state: 'running', ...(allow ? {} : { steps: [...rest.steps, denied] }) };
      this.transcript(jobId, { t: 'notice', text: allow ? 'approved' : 'denied', at: this.now() });
      this.save(live.job, true);
    }
    if (live) this.showAsk(live);
    return true;
  }

  private dropAsks(jobId: string): void {
    const queue = this.asks.get(jobId);
    if (!queue) return;
    this.asks.delete(jobId);
    for (const a of queue) a.resolve(false);
  }

  stop(jobId: string, error?: string): boolean {
    const live = [...this.live.values()].find((l) => l.job?.id === jobId);
    if (live?.job && live.job.state !== 'running' && live.job.state !== 'attention' && live.job.background) {
      live.session.stop();
      this.setBackground(live, 0);
      return true;
    }
    if (!live?.job || (live.job.state !== 'running' && live.job.state !== 'attention')) return false;
    const { background: _bg, ...was } = live.job;
    const job: Job = { ...was, state: 'stopped', ...(error ? { error } : {}), ended: this.now() };
    clearTimeout(this.waits.get(jobId));
    this.waits.delete(jobId);
    this.meanwhile.delete(jobId);
    live.job = job;
    live.queue = [];
    live.session.stop();
    this.transcript(job.id, { t: 'end', ok: false, error: error ?? 'stopped', at: this.now() });
    this.save(job, true);
    this.settleChanges(job.id);
    this.endPart(live);
    return true;
  }

  // ---------------------------------------------------------------- what a job changed

  /** After a job ended: what it changed goes onto its card (and to the other members). */
  private settleChanges(jobId: string): void {
    const snapshots = this.deps.snapshots;
    if (!snapshots) return;
    void snapshots
      .after(jobId)
      .then((changes) => {
        if (changes) this.setChanges(jobId, changes);
      })
      .catch(() => {});
  }

  private setChanges(jobId: string, changes: JobChanges): void {
    const job = this.deps.store.job(jobId);
    if (!job) return;
    const next: Job = { ...job, changes };
    const live = [...this.live.values()].find((l) => l.job?.id === jobId);
    if (live) live.job = next;
    this.published.delete(jobId);
    this.save(next, true);
  }

  /** One changed file of a job as a diff. */
  async diff(jobId: string, path: string): Promise<{ patch: string; truncated?: true }> {
    const job = this.deps.store.job(jobId);
    const file = job?.changes?.files.find((f) => f.path === path);
    if (!file || !this.deps.snapshots) throw new CoreError('no_snapshot');
    if (file.binary) return { patch: '' };
    return this.deps.snapshots.diff(jobId, path);
  }

  /** Takes a job's changes back, all of them or the files named; files changed since are left as they are. */
  async undo(jobId: string, paths?: string[]): Promise<{ undone: string[]; skipped: string[] }> {
    const job = this.deps.store.job(jobId);
    if (!job?.changes || !this.deps.snapshots) throw new CoreError('no_snapshot');
    if (job.state === 'running' || job.state === 'attention') throw new CoreError('busy');
    const files = job.changes.files.filter((f) => !f.undone && (!paths || paths.includes(f.path)));
    const result = await this.deps.snapshots.undo(jobId, files);
    if (result.undone.length > 0) {
      const latest = this.deps.store.job(jobId)?.changes ?? job.changes;
      this.setChanges(jobId, {
        ...latest,
        files: latest.files.map((f) => (result.undone.includes(f.path) ? { ...f, undone: true as const } : f)),
      });
    }
    return result;
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

  /** Jobs that wait for this computer's person: an approval asked while working, or one before they start. */
  waiting(): Job[] {
    const out = this.active().filter((j) => j.state === 'attention');
    for (const id of this.held.keys()) {
      const job = this.deps.store.job(id);
      if (job?.state === 'attention' && !out.some((j) => j.id === id)) out.push(job);
    }
    return out;
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

  /** Images the agent attached to its current job's answer (`attach_image`), by job id, until it ends. */
  private readonly pictures = new Map<string, MessageImage[]>();
  /** Questions the agent left to the person on its current job's answer (`ask_decision`), by job id. */
  private readonly decisions = new Map<string, Decision[]>();

  /** Adds a question to the answer of the agent's current job; `full` past the limit. */
  askDecision(
    agentId: string,
    channelId: string,
    slot: string | undefined,
    decision: Decision,
  ): 'ok' | 'none' | 'full' {
    const job = this.current(agentId, channelId, slot);
    if (!job) return 'none';
    const list = this.decisions.get(job.id) ?? [];
    if (list.length >= REPORT_DECISIONS_MAX) return 'full';
    this.decisions.set(job.id, [...list, decision]);
    return 'ok';
  }

  /**
   * Attaches an image to the answer of the agent's current job in that session. `none` without a running job,
   * `full` once it has as many as a message carries.
   */
  attachImage(
    agentId: string,
    channelId: string,
    slot: string | undefined,
    image: MessageImage,
  ): 'ok' | 'none' | 'full' {
    const job = this.current(agentId, channelId, slot);
    if (!job) return 'none';
    const list = this.pictures.get(job.id) ?? [];
    if (list.some((i) => i.blob === image.blob)) return 'ok';
    if (list.length >= MESSAGE_IMAGES_MAX) return 'full';
    this.pictures.set(job.id, [...list, image]);
    return 'ok';
  }

  /** A progress note from the agent (Rumpus's post_progress tool) on its current job. */
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
      if (!live.spare) this.deps.store.setSession(live.agent.id, live.slot, e.id);
      return;
    }
    if (e.type === 'quota') {
      const key = live.agent.account ? `${live.agent.kind}:${live.agent.account}` : live.agent.kind;
      this.quotas[key] = e.quota;
      this.deps.emitQuota(key, e.quota);
      return;
    }
    if (e.type === 'tasks') {
      this.setBackground(live, e.running);
      return;
    }
    if (e.type === 'wake') {
      this.wake(live, e.text);
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
        live.unposted = e.text;
        next = { ...job, preview: undefined };
        this.transcript(job.id, { t: 'text', text: e.text, at });
        break;
      case 'tool':
        // What it wrote before reaching for a tool was for the people watching, not its answer: it goes into the
        // channel now, as if the agent had typed it there.
        this.postNote(live, job);
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
        if (!e.ok && this.moveToSpare(live, job, e.error)) return;
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
        this.settleChanges(job.id);
        const answer = (e.final ?? live.lastText).trim();
        // A job that ended on a tool call has its last note as its answer: the note gives way to the answer.
        if (answer && live.posted && live.posted.text.trim() === answer) {
          this.deps.store.commit({ type: 'message.deleted', data: { id: live.posted.id } });
          this.deps.emitDeleted?.({ id: live.posted.id, channelId: live.channelId });
        }
        live.unposted = undefined;
        live.posted = undefined;
        if (answer || this.pictures.has(job.id) || this.decisions.has(job.id)) this.postAnswer(live, ended, answer);
        this.pictures.delete(job.id);
        this.decisions.delete(job.id);
        this.endPart(live);
        return;
      }
      case 'exit': {
        if (this.moveToSpare(live, job, e.stderr)) return;
        const failed = this.fail(job, job.error ?? (e.stderr ? `exited: ${e.stderr.slice(-400)}` : 'exited'));
        live.job = failed;
        this.settleChanges(job.id);
        this.endPart(live);
        return;
      }
    }
    live.job = next;
    this.save(next);
    if (e.type === 'usage') this.checkTokens(next);
  }

  // ---------------------------------------------------------------- background commands (PLAN.md 5.22)

  /** How many of the agent's background commands still run, on its latest job's card. */
  private setBackground(live: Live, running: number): void {
    const job = live.job;
    if (!job || (job.background ?? 0) === running) return;
    const { background: _was, ...rest } = job;
    live.job = running > 0 ? { ...rest, background: running } : rest;
    this.save(live.job, true);
  }

  /**
   * A background command the agent started ended and the CLI took a turn on it with no message: the turn goes on
   * with the request of the job before it, as a job of its own, and its answer goes into the channel.
   */
  private wake(live: Live, text?: string): void {
    const prev = live.job;
    if (prev?.state === 'running' || prev?.state === 'attention') return;
    const count = prev ? (this.wakes.get(prev.requestId) ?? 0) : MAX_WAKES;
    if (!prev || count >= MAX_WAKES) {
      live.session.stop();
      return;
    }
    this.wakes.set(prev.requestId, count + 1);
    if (prev.background) {
      const { background: _was, ...rest } = prev;
      this.save(rest, true);
    }
    const at = this.now();
    const job: Job = {
      id: newId(),
      channelId: live.channelId,
      agentId: live.agent.id,
      requestId: prev.requestId,
      ...(prev.by ? { by: prev.by } : {}),
      state: 'running',
      steps: [{ id: newId(), kind: 'notice', label: 'woke', ...(text ? { arg: text } : {}), at }],
      usage: { in: 0, cached: 0, out: 0 },
      started: at,
    };
    live.job = job;
    live.lastText = '';
    live.unposted = undefined;
    live.posted = undefined;
    live.queue = [];
    // Nothing to start again on another login: the turn was the CLI's own.
    live.again = undefined;
    this.transcript(job.id, { t: 'notice', text: 'woke', at });
    this.save(job, true);
  }

  /** A step on the job's card and in its transcript: a notice the live view shows in words (`job.tool.<code>`). */
  private mark(live: Live, code: string): void {
    const job = live.job;
    if (!job) return;
    const at = this.now();
    live.job = { ...job, steps: [...job.steps, { id: newId(), kind: 'notice', label: code, at }] };
    this.transcript(job.id, { t: 'notice', text: code, at });
    this.save(live.job, true);
  }

  /**
   * A job that stopped on its login's usage limit: the login counts as out of quota until it resets, and the job
   * starts again on the agent's spare login, once; with nowhere to move it waits for a quota to reset. False when
   * it was another failure, or it already waited as often as it may.
   */
  private moveToSpare(live: Live, job: Job, error: string | undefined): boolean {
    if (this.waits.has(job.id)) return true; // already waiting (the CLI's exit after its last turn)
    const key = quotaKey(live.agent.kind, live.agent.account);
    const quota = this.quotas[key];
    const hit = LIMIT_TEXT.test(error ?? '') || (quota?.status === 'rejected' && quota.at >= job.started);
    if (!hit) return false;
    this.limited.set(key, resetsAt(quota) ?? this.now() + LIMIT_HOLD_MS);
    const again = live.again;
    if (!again) return false;
    if (live.spare || this.moved.has(job.id)) return this.waitForQuota(live, job);
    const next = this.onLogin(again.base);
    if ((next.account ?? '') === (live.agent.account ?? '')) return this.waitForQuota(live, job);
    this.moved.add(job.id);
    this.mark(live, 'spare');
    const moving = live.job ?? job;
    setTimeout(() => {
      void this.start(again.base, again.channel, again.request, again.prompt, again.opts, moving).catch(() => {
        this.fail(moving, 'failed');
      });
    }, 0);
    return true;
  }

  /** When the first of an agent's logins (its own, or its spare) has quota again. */
  private freeAt(agent: Agent): number {
    const logins = [agent.account, ...(agent.spare !== undefined ? [agent.spare || undefined] : [])];
    return Math.min(
      ...logins.map((account) => {
        const key = quotaKey(agent.kind, account);
        const limited = this.limited.get(key) ?? 0;
        return this.outOfQuota(agent.kind, account) ? Math.max(limited, resetsAt(this.quotas[key]) ?? 0) : 0;
      }),
    );
  }

  /**
   * A job out of quota with no login to move to: it stays on its card, waits until a quota resets and then starts
   * again on whichever login has quota (the same conversation where it can), with what was said to it meanwhile.
   */
  private waitForQuota(live: Live, job: Job): boolean {
    const again = live.again;
    const tries = this.waited.get(job.id) ?? 0;
    if (!again || tries >= MAX_WAITS) return false;
    this.waited.set(job.id, tries + 1);
    const at = Math.max(this.freeAt(again.base), this.now()) + WAIT_MARGIN_MS;
    this.mark(live, 'wait_quota');
    const timer = setTimeout(
      () => {
        this.waits.delete(job.id);
        const current = live.job;
        if (current?.id !== job.id || current.state !== 'running') return;
        // The old CLI process stopped at the limit: a new one starts (and resumes the conversation where it can).
        const key = this.key(live.agent.id, live.slot);
        if (this.live.get(key) === live) {
          this.close(live);
          this.live.delete(key);
        }
        void this.start(again.base, again.channel, again.request, again.prompt, again.opts, current).catch(() => {
          this.fail(current, 'failed');
        });
      },
      Math.min(at - this.now(), MAX_TIMER_MS),
    );
    timer.unref?.();
    this.waits.set(job.id, timer);
    return true;
  }

  /**
   * A handed-over part's session ends with its job: the next part starts fresh. A job in a session of its own (a
   * specialist's, or an agent's with fresh sessions) lets go of its CLI too, but its conversation is kept, so
   * writing on its card later goes on in it (`follow`).
   */
  private endPart(live: Live): void {
    const part = live.slot.includes(`#${PART}`);
    if (!part && !live.slot.includes(`#${SPEC}`)) return;
    setTimeout(() => {
      const key = this.key(live.agent.id, live.slot);
      if (this.live.get(key) !== live) return;
      // Its background commands still run: the session stays for the turn their end starts (and ends after it).
      if (live.session.background) return;
      this.close(live);
      this.live.delete(key);
      if (part) this.deps.store.setSession(live.agent.id, live.slot, undefined);
    }, 0);
  }

  /** Posts what the agent wrote while working (before a tool call) as its message in the channel. */
  private postNote(live: Live, job: Job): void {
    const text = live.unposted?.replace(/^\s*GOAL_DONE\s*$/m, '').trim();
    live.unposted = undefined;
    if (!text) return;
    const message: Message = {
      id: newId(),
      channelId: live.channelId,
      author: { kind: 'agent', id: live.agent.id, name: live.agent.name },
      text,
      created: this.now(),
      during: job.id,
    };
    live.posted = { id: message.id, text };
    this.deps.store.commit({ type: 'message.posted', data: message });
    this.deps.emitMessage(message);
  }

  private postAnswer(live: Live, job: Job, answer: string): void {
    // A specialist's RESULT line is for whoever asked, not for the chat.
    const { text, result } = live.agent.specialty?.result ? splitResult(answer) : { text: answer, result: undefined };
    const images = this.pictures.get(job.id);
    const decisions = this.decisions.get(job.id);
    const message: Message = {
      id: newId(),
      channelId: live.channelId,
      author: { kind: 'agent', id: live.agent.id, name: live.agent.name },
      text,
      created: this.now(),
      jobId: job.id,
      ...(result ? { result } : {}),
      ...(images?.length ? { images } : {}),
      ...(decisions?.length ? { decisions } : {}),
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
