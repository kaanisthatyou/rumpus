// The core's RPC server. It does not know the transport: Electron hands it MessagePorts, tests hand it fakes,
// and later the phone and other members will reach the same methods over the network.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Agent,
  AgentInputSchema,
  type Channel,
  CLI_KINDS,
  type CliInfo,
  type CliKind,
  CoreError,
  type CoreEvents,
  type CoreMethods,
  type EventName,
  type Frame,
  isRequest,
  type Language,
  type Message,
  type MethodName,
  type WorkspaceState,
} from '@lonca/protocol';
import { detectAgents, loginCommand } from './agents.js';
import type { OpenSession } from './drivers/types.js';
import { newId } from './ids.js';
import { Jobs } from './jobs.js';
import { type Launch, openConsole, type Runner } from './proc.js';
import { SettingsStore } from './settings.js';
import { WorkspaceStore } from './store.js';
import { tailscaleStatus } from './tailscale.js';

export interface Peer {
  send(frame: Frame): void;
  onFrame(listener: (frame: unknown) => void): void;
  onClose?(listener: () => void): void;
}

export interface CoreOptions {
  /** Lonca's own folder for settings (Electron's userData, or LONCA_HOME). */
  appDir: string;
  language: Language;
  runner?: Runner;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Replaced in tests so that no console window opens. */
  openConsole?: typeof openConsole;
  /** Replaced in tests: fake CLIs instead of real ones. */
  drivers?: Partial<Record<CliKind, OpenSession>>;
  launch?: (path: string) => Launch;
}

type Handler<M extends MethodName> = (params: CoreMethods[M]['params']) => Promise<CoreMethods[M]['result']>;

const MAX_TEXT = 20_000;
const CHANNEL_NAME = /^[\p{Ll}\p{N}][\p{Ll}\p{N}-]{0,39}$/u;

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new CoreError('bad_request', 'text');
  const t = value.trim();
  if (!t || t.length > MAX_TEXT) throw new CoreError('bad_request', 'text');
  return t;
}

export class Core {
  private readonly settings: SettingsStore;
  private readonly peers = new Set<Peer>();
  private readonly deviceId: string;
  private clis: CliInfo[] | undefined;
  private detecting: Promise<CliInfo[]> | undefined;
  private ws: { dir: string; store: WorkspaceStore; jobs: Jobs } | undefined;
  private readonly handlers: { [M in MethodName]: Handler<M> };

  constructor(private readonly opts: CoreOptions) {
    this.settings = new SettingsStore(join(opts.appDir, 'settings.json'), opts.language);
    this.deviceId = this.loadDeviceId();
    this.handlers = {
      'settings.get': async () => this.settings.get(),
      'settings.update': async (patch) => {
        const before = this.settings.get().dataDir;
        const next = this.settings.update(patch);
        if (next.dataDir !== before) this.closeWorkspace();
        this.emit('settings.changed', next);
        return next;
      },
      'clis.list': async (params) => this.listClis(params?.refresh === true),
      'clis.login': async (params) => this.login(params?.kind),
      'tailscale.status': async () =>
        tailscaleStatus({
          ...(opts.runner ? { runner: opts.runner } : {}),
          ...(opts.env ? { env: opts.env } : {}),
          ...(opts.platform ? { platform: opts.platform } : {}),
        }),
      'system.info': async () => ({
        platform: opts.platform ?? process.platform,
        dataDir: this.dataDir(),
        defaultDataDir: this.defaultDataDir(),
      }),
      'workspace.get': async () => this.state(),
      'channels.create': async (p) => this.createChannel(p?.name),
      'channels.rename': async (p) => this.renameChannel(p?.id, p?.name),
      'channels.delete': async (p) => this.deleteChannel(p?.id),
      'messages.list': async (p) => {
        const { store } = this.workspace();
        if (!p || typeof p.channelId !== 'string') throw new CoreError('bad_request');
        const messages = store.messages(p.channelId, {
          ...(typeof p.before === 'number' ? { before: p.before } : {}),
          limit: Math.min(Math.max(Number(p.limit) || 100, 1), 300),
        });
        const ids = messages.map((m) => m.id);
        return { messages, jobs: store.jobsFor(ids) };
      },
      'messages.send': async (p) => this.send(p?.channelId, p?.text),
      'messages.edit': async (p) => this.editMessage(p?.id, p?.text),
      'messages.delete': async (p) => this.deleteMessage(p?.id),
      'messages.search': async (p) => {
        if (typeof p?.query !== 'string') throw new CoreError('bad_request');
        return this.workspace().store.search(p.query, Math.min(Number(p.limit) || 50, 200));
      },
      'agents.save': async (p) => this.saveAgent(p),
      'agents.delete': async (p) => this.deleteAgent(p?.id),
      'agents.newSession': async (p) => {
        if (typeof p?.agentId !== 'string' || typeof p.channelId !== 'string') throw new CoreError('bad_request');
        this.workspace().jobs.newSession(p.agentId, p.channelId);
        return { ok: true as const };
      },
      'jobs.stop': async (p) => {
        if (typeof p?.id !== 'string' || !this.workspace().jobs.stop(p.id)) throw new CoreError('not_found');
        return { ok: true as const };
      },
      'jobs.steer': async (p) => this.steer(p?.id, p?.text),
      'jobs.transcript': async (p) => {
        if (typeof p?.id !== 'string') throw new CoreError('bad_request');
        return this.workspace().jobs.readTranscript(p.id);
      },
      'quota.get': async () => this.workspace().jobs.quotas,
    };
  }

  // ---------------------------------------------------------------- paths and identity

  defaultDataDir(): string {
    return join(this.opts.appDir, 'data');
  }

  dataDir(): string {
    return this.settings.get().dataDir || this.defaultDataDir();
  }

  private loadDeviceId(): string {
    const file = join(this.opts.appDir, 'device.json');
    try {
      const id = (JSON.parse(readFileSync(file, 'utf8')) as { id?: unknown }).id;
      if (typeof id === 'string' && /^[\w-]{8,64}$/.test(id)) return id;
    } catch {
      // first run
    }
    const id = randomBytes(9).toString('base64url');
    mkdirSync(this.opts.appDir, { recursive: true });
    writeFileSync(file, JSON.stringify({ id }));
    return id;
  }

  private me(): { id: string; name: string } {
    return { id: this.deviceId, name: this.settings.get().profile.name || 'Lonca' };
  }

  // ---------------------------------------------------------------- transport

  attach(peer: Peer): void {
    this.peers.add(peer);
    peer.onFrame((frame) => void this.handle(peer, frame));
    peer.onClose?.(() => this.peers.delete(peer));
  }

  emit<E extends EventName>(event: E, data: CoreEvents[E]): void {
    for (const peer of this.peers) peer.send({ event, data });
  }

  private async handle(peer: Peer, frame: unknown): Promise<void> {
    if (!isRequest(frame)) return;
    const { id, method, params } = frame;
    try {
      if (!Object.hasOwn(this.handlers, method)) throw new CoreError('unknown_method', method);
      const handler = this.handlers[method as MethodName] as Handler<MethodName>;
      const result = await handler(params as never);
      peer.send({ id, result });
    } catch (err) {
      const e = err instanceof CoreError ? err : new CoreError('internal', String(err));
      peer.send({ id, error: { code: e.code, message: e.message } });
    }
  }

  shutdown(): void {
    this.closeWorkspace();
  }

  // ---------------------------------------------------------------- CLIs

  private async listClis(refresh: boolean): Promise<CliInfo[]> {
    if (this.clis && !refresh) return this.clis;
    this.detecting ??= detectAgents({
      ...(this.opts.runner ? { runner: this.opts.runner } : {}),
      ...(this.opts.env ? { env: this.opts.env } : {}),
      ...(this.opts.platform ? { platform: this.opts.platform } : {}),
    }).finally(() => {
      this.detecting = undefined;
    });
    const clis = await this.detecting;
    this.clis = clis;
    this.emit('clis.changed', clis);
    return clis;
  }

  private async login(kind: unknown): Promise<{ opened: boolean }> {
    if (typeof kind !== 'string' || !(CLI_KINDS as readonly string[]).includes(kind)) {
      throw new CoreError('bad_request', 'kind');
    }
    const clis = await this.listClis(false);
    const cli = clis.find((a) => a.kind === kind);
    const args = loginCommand(kind as CliKind);
    if (!cli?.path) throw new CoreError('not_installed', kind);
    if (!args) throw new CoreError('login_unavailable', kind);
    const opened = (this.opts.openConsole ?? openConsole)(cli.path, args, this.opts.platform);
    if (!opened) throw new CoreError('login_unavailable', kind);
    return { opened };
  }

  // ---------------------------------------------------------------- workspace

  private workspace(): { dir: string; store: WorkspaceStore; jobs: Jobs } {
    if (this.ws) return this.ws;
    const dir = join(this.dataDir(), 'workspaces', 'personal');
    const store = new WorkspaceStore(join(dir, 'lonca.db'), this.deviceId);
    store.closeOrphanJobs(Date.now());
    if (!store.meta('created')) {
      store.setMeta('created', String(Date.now()));
      store.setMeta('name', 'personal');
      const channel: Channel = {
        id: newId(),
        name: this.settings.get().language === 'tr' ? 'genel' : 'general',
        kind: 'channel',
        topic: '',
        created: Date.now(),
      };
      store.commit({ type: 'channel.created', data: channel });
    }
    const jobs = new Jobs({
      store,
      dir,
      clis: () => this.listClis(false),
      me: () => ({ ...this.me(), language: this.settings.get().language }),
      emitJob: (job) => this.emit('job.updated', job),
      emitMessage: (message) => this.emit('message.added', message),
      emitQuota: (kind, quota) => this.emit('quota.changed', { kind, quota }),
      ...(this.opts.drivers ? { drivers: this.opts.drivers } : {}),
      ...(this.opts.launch ? { launch: this.opts.launch } : {}),
    });
    this.ws = { dir, store, jobs };
    return this.ws;
  }

  private closeWorkspace(): void {
    if (!this.ws) return;
    this.ws.jobs.disposeAll();
    this.ws.store.close();
    this.ws = undefined;
  }

  private state(): WorkspaceState {
    const { store, jobs } = this.workspace();
    return {
      id: 'personal',
      name: store.meta('name') ?? 'personal',
      me: this.me(),
      channels: store.channels(),
      agents: store.agents(),
      active: jobs.active(),
    };
  }

  private changed(): void {
    this.emit('workspace.changed', this.state());
  }

  private createChannel(name: unknown): Channel {
    const { store } = this.workspace();
    const clean = typeof name === 'string' ? name.trim().toLocaleLowerCase('tr').replace(/\s+/g, '-') : '';
    if (!CHANNEL_NAME.test(clean)) throw new CoreError('bad_request', 'name');
    if (store.channels().some((c) => c.kind === 'channel' && c.name === clean)) throw new CoreError('handle_taken');
    const channel: Channel = { id: newId(), name: clean, kind: 'channel', topic: '', created: Date.now() };
    store.commit({ type: 'channel.created', data: channel });
    this.changed();
    return channel;
  }

  private renameChannel(id: unknown, name: unknown): Channel {
    const { store } = this.workspace();
    const channel = typeof id === 'string' ? store.channel(id) : undefined;
    if (!channel || channel.kind !== 'channel') throw new CoreError('not_found');
    const clean = typeof name === 'string' ? name.trim().toLocaleLowerCase('tr').replace(/\s+/g, '-') : '';
    if (!CHANNEL_NAME.test(clean)) throw new CoreError('bad_request', 'name');
    store.commit({ type: 'channel.renamed', data: { id: channel.id, name: clean } });
    this.changed();
    return { ...channel, name: clean };
  }

  private deleteChannel(id: unknown): { ok: true } {
    const { store } = this.workspace();
    const channel = typeof id === 'string' ? store.channel(id) : undefined;
    if (!channel || channel.kind !== 'channel') throw new CoreError('not_found');
    if (store.channels().filter((c) => c.kind === 'channel').length <= 1) throw new CoreError('bad_request', 'last');
    store.commit({ type: 'channel.deleted', data: { id: channel.id } });
    this.changed();
    return { ok: true };
  }

  private send(channelId: unknown, value: unknown): Message {
    const { store, jobs } = this.workspace();
    const channel = typeof channelId === 'string' ? store.channel(channelId) : undefined;
    if (!channel) throw new CoreError('not_found');
    const me = this.me();
    const message: Message = {
      id: newId(),
      channelId: channel.id,
      author: { kind: 'person', id: me.id, name: me.name },
      text: text(value),
      created: Date.now(),
    };
    store.commit({ type: 'message.posted', data: message });
    this.emit('message.added', message);
    void jobs.onMessage(message, channel);
    return message;
  }

  private ownMessage(id: unknown): Message {
    const { store } = this.workspace();
    const message = typeof id === 'string' ? store.message(id) : undefined;
    if (!message) throw new CoreError('not_found');
    if (message.author.kind !== 'person' || message.author.id !== this.deviceId)
      throw new CoreError('bad_request', 'owner');
    return message;
  }

  private editMessage(id: unknown, value: unknown): Message {
    const message = this.ownMessage(id);
    const edited = { ...message, text: text(value), edited: Date.now() };
    this.workspace().store.commit({
      type: 'message.edited',
      data: { id: edited.id, text: edited.text, edited: edited.edited },
    });
    this.emit('message.updated', edited);
    return edited;
  }

  private deleteMessage(id: unknown): { ok: true } {
    const message = this.ownMessage(id);
    this.workspace().store.commit({ type: 'message.deleted', data: { id: message.id } });
    this.emit('message.deleted', { id: message.id, channelId: message.channelId });
    return { ok: true };
  }

  private saveAgent(input: unknown): Agent {
    const { store, jobs } = this.workspace();
    const parsed = AgentInputSchema.safeParse(input);
    if (!parsed.success) throw new CoreError('invalid_agent', parsed.error.message);
    const p = parsed.data;
    const existing = p.id ? store.agent(p.id) : undefined;
    if (p.id && !existing) throw new CoreError('not_found');
    if (store.agents().some((a) => a.handle === p.handle && a.id !== p.id)) throw new CoreError('handle_taken');
    if (!isDir(p.folder)) throw new CoreError('folder_missing');
    const agent: Agent = {
      id: existing?.id ?? newId(),
      kind: p.kind,
      name: p.name,
      handle: p.handle,
      folder: p.folder,
      mode: p.mode,
      ...(p.model ? { model: p.model } : {}),
      instructions: p.instructions,
      created: existing?.created ?? Date.now(),
    };
    store.commit({ type: 'agent.saved', data: agent });
    const own = store.channels().find((c) => c.kind === 'agent' && c.agentId === agent.id);
    if (!own) {
      store.commit({
        type: 'channel.created',
        data: { id: newId(), name: agent.handle, kind: 'agent', agentId: agent.id, topic: '', created: Date.now() },
      });
    } else if (own.name !== agent.handle) {
      store.commit({ type: 'channel.renamed', data: { id: own.id, name: agent.handle } });
    }
    if (existing && (existing.kind !== agent.kind || existing.folder !== agent.folder)) jobs.dropAgent(agent.id);
    this.changed();
    return agent;
  }

  private deleteAgent(id: unknown): { ok: true } {
    const { store, jobs } = this.workspace();
    const agent = typeof id === 'string' ? store.agent(id) : undefined;
    if (!agent) throw new CoreError('not_found');
    jobs.dropAgent(agent.id);
    store.commit({ type: 'agent.deleted', data: { id: agent.id } });
    const own = store.channels().find((c) => c.kind === 'agent' && c.agentId === agent.id);
    if (own) store.commit({ type: 'channel.deleted', data: { id: own.id } });
    this.changed();
    return { ok: true };
  }

  private steer(id: unknown, value: unknown): { ok: true } {
    const { store, jobs } = this.workspace();
    const job = typeof id === 'string' ? store.job(id) : undefined;
    if (!job) throw new CoreError('not_found');
    const t = text(value);
    // The steer is also a message, so the channel keeps the whole conversation.
    const me = this.me();
    const message: Message = {
      id: newId(),
      channelId: job.channelId,
      author: { kind: 'person', id: me.id, name: me.name },
      text: t,
      created: Date.now(),
    };
    store.commit({ type: 'message.posted', data: message });
    this.emit('message.added', message);
    if (!jobs.steer(job.id, t)) throw new CoreError('busy');
    return { ok: true };
  }
}
