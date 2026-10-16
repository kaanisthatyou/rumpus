// The core's RPC server. It does not know the transport: Electron hands it MessagePorts, tests hand it fakes,
// and later the phone and other members will reach the same methods over the network.
import { join } from 'node:path';
import {
  AGENT_KINDS,
  type AgentInfo,
  type AgentKind,
  CoreError,
  type CoreEvents,
  type CoreMethods,
  type EventName,
  type Frame,
  isRequest,
  type Language,
  type MethodName,
} from '@lonca/protocol';
import { detectAgents, loginCommand } from './agents.js';
import { openConsole, type Runner } from './proc.js';
import { SettingsStore } from './settings.js';
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
}

type Handler<M extends MethodName> = (params: CoreMethods[M]['params']) => Promise<CoreMethods[M]['result']>;

export class Core {
  private readonly settings: SettingsStore;
  private readonly peers = new Set<Peer>();
  private agents: AgentInfo[] | undefined;
  private detecting: Promise<AgentInfo[]> | undefined;
  private readonly handlers: { [M in MethodName]: Handler<M> };

  constructor(private readonly opts: CoreOptions) {
    this.settings = new SettingsStore(join(opts.appDir, 'settings.json'), opts.language);
    this.handlers = {
      'settings.get': async () => this.settings.get(),
      'settings.update': async (patch) => {
        const next = this.settings.update(patch);
        this.emit('settings.changed', next);
        return next;
      },
      'agents.list': async (params) => this.listAgents(params?.refresh === true),
      'agents.login': async (params) => this.login(params?.kind),
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
    };
  }

  defaultDataDir(): string {
    return join(this.opts.appDir, 'data');
  }

  dataDir(): string {
    return this.settings.get().dataDir || this.defaultDataDir();
  }

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

  private async listAgents(refresh: boolean): Promise<AgentInfo[]> {
    if (this.agents && !refresh) return this.agents;
    this.detecting ??= detectAgents({
      ...(this.opts.runner ? { runner: this.opts.runner } : {}),
      ...(this.opts.env ? { env: this.opts.env } : {}),
      ...(this.opts.platform ? { platform: this.opts.platform } : {}),
    }).finally(() => {
      this.detecting = undefined;
    });
    const agents = await this.detecting;
    this.agents = agents;
    this.emit('agents.changed', agents);
    return agents;
  }

  private async login(kind: unknown): Promise<{ opened: boolean }> {
    if (typeof kind !== 'string' || !(AGENT_KINDS as readonly string[]).includes(kind)) {
      throw new CoreError('bad_request', 'kind');
    }
    const agents = await this.listAgents(false);
    const agent = agents.find((a) => a.kind === kind);
    const args = loginCommand(kind as AgentKind);
    if (!agent?.path) throw new CoreError('not_installed', kind);
    if (!args) throw new CoreError('login_unavailable', kind);
    const opened = (this.opts.openConsole ?? openConsole)(agent.path, args, this.opts.platform);
    if (!opened) throw new CoreError('login_unavailable', kind);
    return { opened };
  }
}
