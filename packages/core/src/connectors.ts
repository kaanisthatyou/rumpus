// This computer's connectors (PLAN.md 5.9) in `<app>/connectors.json`: never synced, because a connector belongs
// to the member whose machine runs it (principle 2). Secret values are sealed by the main process (safeStorage)
// and opened only to be sent to their own server. Rumpus connects to each server itself, on first use, and closes
// it again after a while without calls.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  type ConnectorInfo,
  type ConnectorInput,
  type ConnectorSource,
  type ConnectorsState,
  type ConnectorTool,
  CoreError,
  connectorUrlAllowed,
  type KeyProtection,
  OAUTH_REDIRECT_PORT,
  REGISTRY_URL,
  type RegistryServer,
  readRegistryServer,
  SECRET_NAME,
  TOOL_POLICIES,
  type ToolPolicy,
} from '@lonca/protocol';
import { newId } from './ids.js';
import { connectorEnv, McpAuthError, type McpCallResult, McpClient, McpError, type McpTarget } from './mcp.js';
import {
  authorizeUrl,
  discover,
  exchange,
  GrantRefused,
  LoopbackCallback,
  type OAuthClient,
  type OAuthServer,
  pkce,
  probeChallenge,
  refresh,
  register,
} from './oauth.js';
import { which } from './proc.js';

/** Seals and opens secrets; the main process's safeStorage in the app. */
export interface Sealer {
  protection(): KeyProtection;
  seal(plain: string): Promise<string>;
  open(sealed: string): Promise<string>;
}

/** No way to seal: connectors without secrets still work. */
export const noSealer: Sealer = {
  protection: () => 'none',
  seal: () => Promise.reject(new CoreError('connector_storage')),
  open: () => Promise.reject(new CoreError('connector_storage')),
};

/** The core side of the main process's sealer, over the utility process's parent port. */
export class PortSealer implements Sealer {
  private level: KeyProtection = 'none';
  private next = 1;
  private readonly pending = new Map<number, { resolve: (s: string) => void; reject: (e: Error) => void }>();

  constructor(private readonly post: (message: unknown) => void) {}

  /** Feed every message from the parent port here; returns whether it was a sealer message. */
  receive(m: unknown): boolean {
    const msg = m as { type?: string; id?: number; value?: unknown; error?: string };
    if (msg?.type === 'secrets' && typeof msg.value === 'string') {
      this.level = msg.value as KeyProtection;
      return true;
    }
    if (msg?.type === 'sealed' && typeof msg.id === 'number') {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (p && typeof msg.value === 'string') p.resolve(msg.value);
      else p?.reject(new CoreError('connector_storage', msg.error));
      return true;
    }
    return false;
  }

  protection(): KeyProtection {
    return this.level;
  }

  private ask(type: 'seal' | 'unseal', value: string): Promise<string> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ type, id, value });
    });
  }

  seal(plain: string): Promise<string> {
    return this.ask('seal', plain);
  }

  open(sealed: string): Promise<string> {
    return this.ask('unseal', sealed);
  }
}

interface StoredTool extends ConnectorTool {
  inputSchema: Record<string, unknown>;
}

/** A connector's sign-in as kept in the file: every token and the client's secret are sealed. */
interface StoredOAuth {
  state: 'needed' | 'signed_in';
  error?: string;
  detail?: string;
  /** Entered by hand; its redirect address has the fixed port. */
  clientId?: string;
  /** Where the sign-in went, as found that day. */
  server?: OAuthServer;
  /** The client the app registered itself, with the port its redirect address has. */
  client?: { id: string; method: OAuthClient['method']; secret?: string; port: number };
  access?: string;
  refresh?: string;
  expires?: number;
}

interface Stored extends Omit<ConnectorInfo, 'secrets' | 'tools' | 'oauth'> {
  secrets: { name: string; hint: string; sealed: string }[];
  tools: StoredTool[];
  oauth?: StoredOAuth;
}

/** A connector's tool as agents see it: `<slug>__<tool>`, kept short enough for every CLI's name limit. */
export interface ExposedTool {
  exposed: string;
  connector: ConnectorInfo;
  tool: StoredTool;
}

const IDLE_MS = 10 * 60_000;
const CALL_MS = 5 * 60_000;
const MAX_CONNECTORS = 50;
/** How long the browser may take with a sign-in. */
const SIGN_IN_MS = 10 * 60_000;
/** A token this close to its end is renewed before it is used. */
const RENEW_BEFORE_MS = 60_000;
const CLIENT_ID = /^[\x21-\x7e]{1,200}$/;

/** A server's 401 means a sign-in only where no key of the person's own is sent as `Authorization`. */
const signsIn = (c: Stored) => c.kind === 'remote' && !c.secrets.some((s) => /^authorization$/i.test(s.name));

function slugOf(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
  return s || 'connector';
}

/** `mcp__rumpus__` + this must fit in 64 characters (Anthropic's tool name rule): at most 50 here. */
export function exposedName(slug: string, tool: string): string {
  const clean = tool.replace(/[^A-Za-z0-9_-]/g, '_');
  const full = `${slug}__${clean}`;
  if (full.length <= 50 && clean === tool) return full;
  const hash = createHash('sha256').update(tool).digest('hex').slice(0, 4);
  return `${full.slice(0, 45)}_${hash}`;
}

/** An install record as given, kept to its shape. */
function sourceOf(raw: unknown): { source?: ConnectorSource } {
  const s = raw as ConnectorSource | undefined;
  if (!s || (s.from !== 'catalog' && s.from !== 'registry') || typeof s.name !== 'string') return {};
  if (!['remote', 'npm', 'pypi', 'oci'].includes(s.via)) return {};
  return {
    source: {
      from: s.from,
      name: s.name.slice(0, 200),
      via: s.via,
      ...(typeof s.version === 'string' ? { version: s.version.slice(0, 100) } : {}),
    },
  };
}

const hint = (value: string) => (value.length > 8 ? `…${value.slice(-4)}` : '…');

export class Connectors {
  private list: Stored[] = [];
  private readonly live = new Map<string, { client: Promise<McpClient>; timer?: NodeJS.Timeout }>();
  private listeners: ((state: ConnectorsState) => void)[] = [];
  /** Sign-ins the browser is open for. */
  private readonly flows = new Map<string, { cancel: () => void }>();
  /** Token renewals in progress, so that requests at the same moment share one. */
  private readonly renewing = new Map<string, Promise<string>>();

  constructor(
    private readonly file: string,
    private readonly sealer: Sealer,
    private readonly opts: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; cwd?: string; registry?: string } = {},
  ) {
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8')) as { v?: number; connectors?: Stored[] };
        if (data.v === 1 && Array.isArray(data.connectors)) this.list = data.connectors;
        // A test the app closed during never finished.
        for (const c of this.list) if (c.state === 'testing') c.state = 'untested';
      } catch {
        // A damaged file starts over; its secrets could not be read anyway.
      }
    }
  }

  onChange(l: (state: ConnectorsState) => void): void {
    this.listeners.push(l);
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify({ v: 1, connectors: this.list }, null, 2), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
    const state = this.state();
    for (const l of this.listeners) l(state);
  }

  private view(c: Stored): ConnectorInfo {
    const { oauth, ...rest } = c;
    return {
      ...rest,
      secrets: c.secrets.map(({ name, hint }) => ({ name, hint })),
      tools: c.tools.map(({ inputSchema: _s, ...t }) => t),
      ...(oauth
        ? {
            oauth: {
              state: this.flows.has(c.id) ? 'waiting' : oauth.state,
              ...(oauth.server ? { issuer: oauth.server.issuer } : {}),
              ...(oauth.error ? { error: oauth.error } : {}),
              ...(oauth.detail ? { detail: oauth.detail } : {}),
              ...(oauth.clientId ? { clientId: oauth.clientId } : {}),
            },
          }
        : {}),
    };
  }

  state(): ConnectorsState {
    return { protection: this.sealer.protection(), connectors: this.list.map((c) => this.view(c)) };
  }

  get(id: string): ConnectorInfo | undefined {
    const c = this.list.find((x) => x.id === id);
    return c ? this.view(c) : undefined;
  }

  async save(input: ConnectorInput): Promise<ConnectorsState> {
    const i = (input ?? {}) as Partial<ConnectorInput>;
    const existing = typeof i.id === 'string' ? this.list.find((c) => c.id === i.id) : undefined;
    if (i.id !== undefined && !existing) throw new CoreError('not_found');
    if (!existing && this.list.length >= MAX_CONNECTORS) throw new CoreError('invalid_connector', 'too many');
    const name = typeof i.name === 'string' ? i.name.trim().slice(0, 40) : '';
    if (!name) throw new CoreError('invalid_connector', 'name');
    const kind = i.kind === 'local' ? 'local' : i.kind === 'remote' ? 'remote' : undefined;
    if (!kind) throw new CoreError('invalid_connector', 'kind');
    const url = typeof i.url === 'string' ? i.url.trim() : '';
    const command = typeof i.command === 'string' ? i.command.trim() : '';
    const args = Array.isArray(i.args) ? i.args.filter((a): a is string => typeof a === 'string').slice(0, 40) : [];
    if (kind === 'remote' && (!url || url.length > 2000 || !connectorUrlAllowed(url)))
      throw new CoreError('invalid_connector', 'url');
    if (kind === 'local' && (!command || command.length > 500 || args.some((a) => a.length > 2000)))
      throw new CoreError('invalid_connector', 'command');

    const secrets = [...(existing?.secrets ?? [])];
    for (const s of Array.isArray(i.secrets) ? i.secrets.slice(0, 20) : []) {
      const sname = typeof s?.name === 'string' ? s.name.trim() : '';
      if (!SECRET_NAME.test(sname)) throw new CoreError('invalid_connector', 'secret');
      const value = typeof s.value === 'string' ? s.value.trim() : '';
      const at = secrets.findIndex((x) => x.name.toLowerCase() === sname.toLowerCase());
      if (!value) {
        if (at >= 0) secrets.splice(at, 1);
        continue;
      }
      if (value.length > 8000 || /[\r\n]/.test(value)) throw new CoreError('invalid_connector', 'secret');
      if (this.sealer.protection() === 'none') throw new CoreError('connector_storage');
      const entry = { name: sname, hint: hint(value), sealed: await this.sealer.seal(value) };
      if (at >= 0) secrets[at] = entry;
      else secrets.push(entry);
    }

    // The sign-in belongs to the server's address and to the client it was made with.
    let oauth = existing && kind === 'remote' && existing.url === url ? existing.oauth : undefined;
    if (typeof i.clientId === 'string' && kind === 'remote') {
      const clientId = i.clientId.trim();
      if (clientId && !CLIENT_ID.test(clientId)) throw new CoreError('invalid_connector', 'clientId');
      if (clientId !== (oauth?.clientId ?? ''))
        oauth = clientId || oauth ? { state: 'needed', ...(clientId ? { clientId } : {}) } : undefined;
    }

    const taken = new Set(this.list.filter((c) => c !== existing).map((c) => c.slug));
    let slug = existing?.slug ?? slugOf(name);
    for (let n = 2; taken.has(slug); n++) slug = `${slugOf(name).slice(0, 17)}_${n}`;
    // Only this computer's own agents ever reach the gateway, so an id of anyone else's agent gives nothing.
    const agents = [
      ...new Set(
        Array.isArray(i.agents) ? i.agents.filter((a) => typeof a === 'string' && /^[\w-]{1,64}$/.test(a)) : [],
      ),
    ].slice(0, 200);
    const changedTarget =
      !existing ||
      existing.kind !== kind ||
      existing.url !== (kind === 'remote' ? url : undefined) ||
      existing.command !== (kind === 'local' ? command : undefined) ||
      JSON.stringify(existing.args ?? []) !== JSON.stringify(kind === 'local' ? args : []) ||
      JSON.stringify(existing.secrets) !== JSON.stringify(secrets) ||
      existing.oauth !== oauth;
    const next: Stored = {
      id: existing?.id ?? newId(),
      name,
      slug,
      kind,
      ...(kind === 'remote' ? { url } : { command, args }),
      secrets,
      agents,
      tools: existing?.tools ?? [],
      ...(existing?.source ? { source: existing.source } : sourceOf(i.source)),
      ...(oauth ? { oauth } : {}),
      state: changedTarget ? 'untested' : (existing?.state ?? 'untested'),
      ...(!changedTarget && existing?.server ? { server: existing.server } : {}),
      ...(!changedTarget && existing?.tested ? { tested: existing.tested } : {}),
      added: existing?.added ?? Date.now(),
    };
    if (existing) this.list[this.list.indexOf(existing)] = next;
    else this.list.push(next);
    if (existing && existing.oauth !== oauth) this.endFlow(existing.id);
    this.persist();
    if (changedTarget) void this.test(next.id);
    return this.state();
  }

  remove(id: string): ConnectorsState {
    const c = this.list.find((x) => x.id === id);
    if (!c) throw new CoreError('not_found');
    this.endFlow(id);
    this.stop(id);
    this.list = this.list.filter((x) => x !== c);
    this.persist();
    return this.state();
  }

  setPolicy(id: string, tool: string, policy: ToolPolicy): ConnectorsState {
    const c = this.list.find((x) => x.id === id);
    const t = c?.tools.find((x) => x.name === tool);
    if (!c || !t) throw new CoreError('not_found');
    if (!(TOOL_POLICIES as readonly string[]).includes(policy)) throw new CoreError('bad_request', 'policy');
    t.policy = policy;
    this.persist();
    return this.state();
  }

  /**
   * Connects anew and reads the tools; new tools start as `allow` when they only read, else `ask`. The connector
   * shows as `testing` from the moment this is called until it settles.
   */
  test(id: string): Promise<ConnectorsState> {
    const c = this.list.find((x) => x.id === id);
    if (!c) throw new CoreError('not_found');
    this.stop(id);
    c.state = 'testing';
    this.persist();
    const run = (this.testing.get(id) ?? Promise.resolve()).then(() => this.runTest(c));
    this.testing.set(id, run);
    void run.finally(() => {
      if (this.testing.get(id) === run) this.testing.delete(id);
    });
    return run;
  }

  /** Tests in progress, so that a second test waits for the first. */
  private readonly testing = new Map<string, Promise<ConnectorsState>>();

  private async runTest(c: Stored): Promise<ConnectorsState> {
    const id = c.id;
    // Changed or removed meanwhile: that change brings its own test.
    const stale = () => !this.list.includes(c);
    if (stale()) return this.state();
    try {
      const client = await this.client(c);
      const defs = await client.tools();
      if (stale()) return this.state();
      const before = new Map(c.tools.map((t) => [t.name, t.policy]));
      c.tools = defs.map((d) => ({
        name: d.name,
        ...(d.title ? { title: d.title } : {}),
        description: d.description,
        readOnly: d.readOnly,
        inputSchema: d.inputSchema,
        policy: before.get(d.name) ?? (d.readOnly ? 'allow' : 'ask'),
      }));
      c.server = client.server;
      c.state = 'ok';
      delete c.error;
      delete c.detail;
    } catch (e) {
      if (stale()) return this.state();
      this.stop(id);
      c.state = 'failed';
      if (e instanceof McpAuthError && signsIn(c)) {
        // The server asks for a sign-in, or the one it had has ended.
        this.signedOut(c);
        c.error = 'connector_auth';
        delete c.detail;
      } else {
        c.error = e instanceof CoreError ? e.code : 'connector_failed';
        c.detail = (e instanceof McpError ? e.detail : e instanceof Error ? e.message : String(e)).slice(0, 500);
      }
    }
    c.tested = Date.now();
    this.persist();
    return this.state();
  }

  /** The tools an agent may see: its connectors that work, without blocked tools. */
  forAgent(agentId: string): ExposedTool[] {
    const out: ExposedTool[] = [];
    for (const c of this.list) {
      // While a working connector is tested again, its agents keep the tools it had.
      const usable = c.state === 'ok' || (c.state === 'testing' && c.tools.length > 0 && c.server !== undefined);
      if (!usable || !c.agents.includes(agentId)) continue;
      const view = this.view(c);
      for (const tool of c.tools) {
        if (tool.policy !== 'blocked') out.push({ exposed: exposedName(c.slug, tool.name), connector: view, tool });
      }
    }
    return out;
  }

  /** What an agent's session was started with; a change starts its CLI again so the tool list is current. */
  fingerprint(agentId: string): string {
    return this.forAgent(agentId)
      .map((t) => t.exposed)
      .join(',');
  }

  async call(id: string, tool: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const c = this.list.find((x) => x.id === id);
    if (!c) throw new CoreError('not_found');
    let client = await this.client(c);
    if (client.dead) {
      this.stop(id);
      client = await this.client(c);
    }
    this.touch(id);
    try {
      return await client.call(tool, args, CALL_MS);
    } catch (e) {
      const cur = this.list.find((x) => x.id === id);
      if (e instanceof McpAuthError && cur && signsIn(cur)) {
        // The sign-in ended in the middle of work: the connector shows it and its agents lose the tools.
        this.stop(id);
        this.signedOut(cur);
        cur.state = 'failed';
        cur.error = 'connector_auth';
        delete cur.detail;
        this.persist();
      }
      throw e;
    } finally {
      this.touch(id);
    }
  }

  // ---------------------------------------------------------------- sign-in (OAuth)

  /** Forgets the tokens and keeps what a new sign-in can use again: the client and where to go. */
  private signedOut(c: Stored): void {
    const { access: _a, refresh: _r, expires: _e, error: _x, detail: _d, ...kept } = c.oauth ?? { state: 'needed' };
    c.oauth = { ...kept, state: 'needed' };
  }

  private endFlow(id: string): void {
    const flow = this.flows.get(id);
    this.flows.delete(id);
    flow?.cancel();
  }

  /**
   * Starts a sign-in and gives the address to open in the browser. What happens next reaches the listeners:
   * tokens sealed and a new test, or the reason it did not finish.
   */
  async signIn(id: string, language: 'tr' | 'en' = 'en'): Promise<{ url: string; state: ConnectorsState }> {
    const c = this.list.find((x) => x.id === id);
    if (!c) throw new CoreError('not_found');
    if (c.kind !== 'remote' || !c.url) throw new CoreError('invalid_connector', 'kind');
    if (this.sealer.protection() === 'none') throw new CoreError('connector_storage');
    this.endFlow(id);
    const fetcher = this.opts.fetch ?? fetch;
    const address = c.url;
    const server = await discover(fetcher, address, await probeChallenge(fetcher, address, await this.headers(c)));
    const manual = c.oauth?.clientId;
    const kept = c.oauth?.server?.issuer === server.issuer ? c.oauth.client : undefined;

    let listener: LoopbackCallback;
    let client: OAuthClient;
    if (manual) {
      listener = await LoopbackCallback.manual().catch(() => {
        throw new CoreError('oauth_failed', `port ${OAUTH_REDIRECT_PORT} on this computer is in use`);
      });
      client = { id: manual, method: 'none' };
    } else {
      // The client registered last time is good only for the port it was registered with.
      const again = kept ? await LoopbackCallback.listen(kept.port).catch(() => undefined) : undefined;
      listener = again ?? (await LoopbackCallback.listen());
      try {
        client =
          again && kept
            ? {
                id: kept.id,
                method: kept.method,
                ...(kept.secret ? { secret: await this.sealer.open(kept.secret) } : {}),
              }
            : await register(fetcher, server, listener.redirectUri);
      } catch (e) {
        listener.close();
        throw e;
      }
    }
    const stored = manual
      ? { clientId: manual }
      : {
          client: {
            id: client.id,
            method: client.method,
            ...(client.secret ? { secret: await this.sealer.seal(client.secret) } : {}),
            port: listener.port,
          },
        };
    const { verifier, challenge, state } = pkce();
    const url = authorizeUrl(server, client, listener.redirectUri, challenge, state);

    const flow = { cancel: () => listener.close() };
    this.flows.set(id, flow);
    const { error: _x, detail: _d, ...before } = c.oauth ?? { state: 'needed' as const };
    c.oauth = before;
    this.persist();

    void listener
      .wait(state, server.issuer, language, SIGN_IN_MS)
      .then((code) => exchange(fetcher, server, client, code, verifier, listener.redirectUri))
      .then(async (tokens) => {
        const access = await this.sealer.seal(tokens.access);
        const renewal = tokens.refresh ? await this.sealer.seal(tokens.refresh) : undefined;
        const cur = this.list.find((x) => x.id === id);
        if (this.flows.get(id) !== flow || !cur || cur.url !== address) return;
        this.flows.delete(id);
        cur.oauth = {
          state: 'signed_in',
          ...stored,
          server,
          access,
          ...(renewal ? { refresh: renewal } : {}),
          ...(tokens.expires ? { expires: tokens.expires } : {}),
        };
        this.persist();
        void this.test(id).catch(() => {});
      })
      .catch((e) => {
        // Cancelled or replaced: whoever did that has already said so.
        if (this.flows.get(id) !== flow) return;
        this.flows.delete(id);
        const cur = this.list.find((x) => x.id === id);
        if (!cur) return;
        cur.oauth = {
          ...(cur.oauth ?? { state: 'needed' }),
          error: e instanceof CoreError ? e.code : 'oauth_failed',
          detail: (e instanceof Error ? e.message : String(e)).slice(0, 500),
        };
        this.persist();
      });
    return { url, state: this.state() };
  }

  cancelSignIn(id: string): ConnectorsState {
    if (!this.list.some((x) => x.id === id)) throw new CoreError('not_found');
    this.endFlow(id);
    this.persist();
    return this.state();
  }

  /** Forgets the tokens on this computer; the server is not told. */
  signOut(id: string): ConnectorsState {
    const c = this.list.find((x) => x.id === id);
    if (!c) throw new CoreError('not_found');
    this.endFlow(id);
    this.stop(id);
    if (c.oauth) {
      this.signedOut(c);
      c.state = 'failed';
      c.error = 'connector_auth';
      delete c.detail;
    }
    this.persist();
    return this.state();
  }

  /** The token for a request: renewed first when it is about to end or the server refused it. */
  private async bearer(id: string, renew: boolean): Promise<string | undefined> {
    const o = this.list.find((x) => x.id === id)?.oauth;
    if (!o?.access) return undefined;
    const left = o.expires === undefined ? Number.POSITIVE_INFINITY : o.expires - Date.now();
    if (!renew && left > RENEW_BEFORE_MS) return this.sealer.open(o.access);
    if (!o.refresh || !o.server) {
      if (!renew && left > 0) return this.sealer.open(o.access);
      throw new McpAuthError('the sign-in has ended', '');
    }
    let run = this.renewing.get(id);
    if (!run) {
      run = this.renew(id, o, o.server, o.refresh).finally(() => this.renewing.delete(id));
      this.renewing.set(id, run);
    }
    return run;
  }

  private async renew(id: string, o: StoredOAuth, server: OAuthServer, sealed: string): Promise<string> {
    const client: OAuthClient = o.client
      ? {
          id: o.client.id,
          method: o.client.method,
          ...(o.client.secret ? { secret: await this.sealer.open(o.client.secret) } : {}),
        }
      : { id: o.clientId ?? '', method: 'none' };
    let tokens: Awaited<ReturnType<typeof refresh>>;
    try {
      tokens = await refresh(this.opts.fetch ?? fetch, server, client, await this.sealer.open(sealed));
    } catch (e) {
      if (e instanceof GrantRefused) throw new McpAuthError(`the sign-in has ended: ${e.message}`, '');
      throw new McpError('connector_failed', e instanceof Error ? e.message : String(e));
    }
    const access = await this.sealer.seal(tokens.access);
    const renewal = tokens.refresh ? await this.sealer.seal(tokens.refresh) : undefined;
    // Signed out or signed in anew meanwhile: this token is used once and not kept.
    if (this.list.find((x) => x.id === id)?.oauth !== o || o.refresh !== sealed) return tokens.access;
    o.access = access;
    if (renewal) o.refresh = renewal;
    if (tokens.expires) o.expires = tokens.expires;
    else delete o.expires;
    this.persist();
    return tokens.access;
  }

  private async headers(c: Stored): Promise<Record<string, string>> {
    const secrets: Record<string, string> = {};
    for (const s of c.secrets) secrets[s.name] = await this.sealer.open(s.sealed);
    return secrets;
  }

  private async target(c: Stored): Promise<McpTarget> {
    const secrets = await this.headers(c);
    if (c.kind === 'remote')
      return {
        kind: 'remote',
        url: c.url ?? '',
        headers: secrets,
        ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
        ...(c.oauth?.access ? { auth: (renew: boolean) => this.bearer(c.id, renew) } : {}),
      };
    return {
      kind: 'local',
      command: c.command ?? '',
      args: c.args ?? [],
      env: connectorEnv(this.opts.env ?? process.env, secrets),
      ...(this.opts.cwd ? { cwd: this.opts.cwd } : {}),
    };
  }

  private client(c: Stored): Promise<McpClient> {
    const running = this.live.get(c.id);
    if (running) return running.client;
    // Generous: a first `npx` or `uvx` start downloads the package.
    const client = this.target(c).then((t) => McpClient.connect(t, 120_000));
    this.live.set(c.id, { client });
    client.catch(() => this.live.delete(c.id));
    this.touch(c.id);
    return client;
  }

  private touch(id: string): void {
    const entry = this.live.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.stop(id), IDLE_MS);
    entry.timer.unref?.();
  }

  private stop(id: string): void {
    const entry = this.live.get(id);
    if (!entry) return;
    this.live.delete(id);
    if (entry.timer) clearTimeout(entry.timer);
    void entry.client.then((c) => c.close()).catch(() => {});
  }

  close(): void {
    for (const id of [...this.flows.keys()]) this.endFlow(id);
    for (const id of [...this.live.keys()]) this.stop(id);
  }

  /** Searches the official MCP Registry by name, latest versions only, active entries only. */
  async search(query: string, cursor?: string): Promise<{ servers: RegistryServer[]; next?: string }> {
    const q = query.trim().slice(0, 100);
    const params = new URLSearchParams({ version: 'latest', limit: '30' });
    if (q) params.set('search', q);
    if (cursor) params.set('cursor', cursor.slice(0, 300));
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 20_000);
    let data: { servers?: unknown; metadata?: { nextCursor?: unknown } };
    try {
      const res = await (this.opts.fetch ?? fetch)(`${this.opts.registry ?? REGISTRY_URL}/v0.1/servers?${params}`, {
        signal: abort.signal,
        redirect: 'error',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length > 8 * 1024 * 1024) throw new Error('too large');
      data = JSON.parse(text);
    } catch {
      throw new CoreError('registry_unreachable');
    } finally {
      clearTimeout(timer);
    }
    const servers: RegistryServer[] = [];
    for (const item of Array.isArray(data.servers) ? data.servers : []) {
      const entry = item as { server?: unknown; _meta?: Record<string, { status?: unknown }> };
      const status = entry._meta?.['io.modelcontextprotocol.registry/official']?.status;
      if (status !== undefined && status !== 'active') continue;
      const server = readRegistryServer(entry.server);
      if (server) servers.push(server);
    }
    const next = data.metadata?.nextCursor;
    return { servers, ...(typeof next === 'string' && next ? { next } : {}) };
  }

  /** The programs that run packages: npx (Node), uvx (uv) and docker. */
  runtimes(): { npx: boolean; uvx: boolean; docker: boolean } {
    const env = this.opts.env ?? process.env;
    return {
      npx: which('npx', [], env) !== undefined,
      uvx: which('uvx', [], env) !== undefined,
      docker: which('docker', [], env) !== undefined,
    };
  }
}
