// A small MCP client for connectors (PLAN.md 5.9): JSON-RPC over a program's stdio (newline-delimited) or over
// Streamable HTTP (POST, answered with JSON or a server-sent event stream). Only what Serai needs: initialize,
// tools/list and tools/call. Requests from the server (sampling, roots, elicitation) are refused.
import type { ChildProcess } from 'node:child_process';
import spawn from 'cross-spawn';
import { LineReader } from './drivers/types.js';
import { killTree, which } from './proc.js';

export const MCP_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'lonca', version: '1' };
/** The most a stdio line or an HTTP answer may hold. */
const MAX_MESSAGE = 8 * 1024 * 1024;

/** A connector that cannot be reached or answers wrongly; `detail` is the server's own text, for the person. */
export class McpError extends Error {
  constructor(
    readonly code: 'connector_failed',
    readonly detail: string,
  ) {
    super(detail);
    this.name = 'McpError';
  }
}

/** The server answered 401: it wants a sign-in or a key. `challenge` is its `WWW-Authenticate` header. */
export class McpAuthError extends McpError {
  constructor(
    detail: string,
    readonly challenge: string,
  ) {
    super('connector_failed', detail);
    this.name = 'McpAuthError';
  }
}

/**
 * Gives the bearer token of a signed-in connector for a request; `renew` asks for a new one because the server
 * refused the last. Undefined sends none.
 */
export type McpAuth = (renew: boolean) => Promise<string | undefined>;

export interface McpToolDef {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
}

export interface McpCallResult {
  content: unknown[];
  isError?: boolean;
  structuredContent?: unknown;
}

interface Transport {
  request(method: string, params: unknown, timeoutMs: number): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  close(): void;
  /** Set once the connection is gone for good. */
  readonly dead: boolean;
}

type Pending = Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>;

function settle(pending: Pending, msg: { id?: unknown; result?: unknown; error?: { message?: unknown } }): void {
  if (typeof msg.id !== 'number') return;
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  clearTimeout(p.timer);
  if (msg.error) p.reject(new McpError('connector_failed', String(msg.error.message ?? 'error').slice(0, 500)));
  else p.resolve(msg.result);
}

function wait(pending: Pending, id: number, timeoutMs: number, method: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new McpError('connector_failed', `no answer to ${method} in ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
  });
}

function failAll(pending: Pending, why: string): void {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new McpError('connector_failed', why));
  }
  pending.clear();
}

/** Variables a connector's program never inherits from Serai: secrets of other tools and Serai's own. */
const DENY_ENV =
  /TOKEN|SECRET|PASSW|API_?KEY|CREDENTIAL|^AUTH|^LONCA_|^ELECTRON_|^ANTHROPIC|^OPENAI|^CLAUDE|^CODEX|^GEMINI|^AWS_|^AZURE_|^GOOGLE_APPLICATION|^NODE_OPTIONS$/i;

export function connectorEnv(base: NodeJS.ProcessEnv, own: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) if (!DENY_ENV.test(k)) env[k] = v;
  return { ...env, ...own };
}

class StdioTransport implements Transport {
  private readonly child: ChildProcess;
  private readonly pending: Pending = new Map();
  private next = 1;
  private stderr = '';
  dead = false;

  constructor(command: string, args: string[], env: NodeJS.ProcessEnv, cwd: string | undefined) {
    const file = which(command, [], env) ?? command;
    this.child = spawn(file, args, {
      env,
      ...(cwd ? { cwd } : {}),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const reader = new LineReader((line) => {
      if (line.length > MAX_MESSAGE) return;
      let msg: { id?: unknown; method?: unknown; result?: unknown; error?: { message?: unknown } };
      try {
        msg = JSON.parse(line);
      } catch {
        return; // a log line on stdout
      }
      if (typeof msg.method === 'string') {
        if (msg.id !== undefined) this.answerServer(msg.id, msg.method);
        return;
      }
      settle(this.pending, msg);
    });
    this.child.stdout?.on('data', (c: Buffer) => reader.push(c));
    this.child.stderr?.on('data', (c: Buffer) => {
      this.stderr = (this.stderr + c.toString()).slice(-2000);
    });
    const gone = (why: string) => {
      this.dead = true;
      failAll(this.pending, why);
    };
    this.child.on('error', (e) => gone(`could not start ${command}: ${e.message}`));
    this.child.on('exit', (code) => gone(this.stderr.trim().split('\n').slice(-5).join('\n') || `exited (${code})`));
    this.child.stdin?.on('error', () => {});
  }

  private write(obj: unknown): void {
    if (!this.dead) this.child.stdin?.write(`${JSON.stringify(obj)}\n`);
  }

  private answerServer(id: unknown, method: string): void {
    if (method === 'ping') this.write({ jsonrpc: '2.0', id, result: {} });
    else this.write({ jsonrpc: '2.0', id, error: { code: -32601, message: 'not supported by Serai' } });
  }

  request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.dead) return Promise.reject(new McpError('connector_failed', 'the program has ended'));
    const id = this.next++;
    const answer = wait(this.pending, id, timeoutMs, method);
    this.write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    return answer;
  }

  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }

  close(): void {
    this.dead = true;
    failAll(this.pending, 'closed');
    this.child.stdin?.end();
    killTree(this.child.pid);
  }
}

class HttpTransport implements Transport {
  private session: string | undefined;
  private version: string | undefined;
  private next = 1;
  private readonly aborts = new Set<AbortController>();
  dead = false;

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string>,
    private readonly fetcher: typeof fetch,
    private readonly auth?: McpAuth,
  ) {}

  setVersion(v: string): void {
    this.version = v;
  }

  private async post(body: unknown, timeoutMs: number, renew = false): Promise<Response> {
    const bearer = await this.auth?.(renew);
    const abort = new AbortController();
    this.aborts.add(abort);
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      return await this.fetcher(this.url, {
        method: 'POST',
        // Never follow a redirect: the secret headers would go along to wherever it points.
        redirect: 'error',
        signal: abort.signal,
        headers: {
          ...this.headers,
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(this.session ? { 'Mcp-Session-Id': this.session } : {}),
          ...(this.version ? { 'MCP-Protocol-Version': this.version } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      const why = abort.signal.aborted ? `no answer in ${Math.round(timeoutMs / 1000)} s` : String(e);
      throw new McpError('connector_failed', why);
    } finally {
      clearTimeout(timer);
      this.aborts.delete(abort);
    }
  }

  async request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.next++;
    const body = { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
    let res = await this.post(body, timeoutMs);
    if (res.status === 401 && this.auth) {
      // The token ended early: once more with a new one.
      void res.body?.cancel().catch(() => {});
      res = await this.post(body, timeoutMs, true);
    }
    const session = res.headers.get('mcp-session-id');
    if (session) this.session = session;
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300);
      const detail = `HTTP ${res.status}${text ? `: ${text}` : ''}`;
      if (res.status === 401) throw new McpAuthError(detail, res.headers.get('www-authenticate') ?? '');
      throw new McpError('connector_failed', detail);
    }
    const type = res.headers.get('content-type') ?? '';
    const msg = type.includes('text/event-stream') ? await this.fromStream(res, id) : await this.fromJson(res);
    const one = Array.isArray(msg) ? msg.find((m) => m?.id === id) : msg;
    if (!one || one.id !== id) throw new McpError('connector_failed', 'no answer to the request');
    if (one.error) throw new McpError('connector_failed', String(one.error.message ?? 'error').slice(0, 500));
    return one.result;
  }

  private async fromJson(res: Response): Promise<{ id?: unknown; result?: unknown; error?: { message?: unknown } }> {
    const text = await res.text();
    if (text.length > MAX_MESSAGE) throw new McpError('connector_failed', 'answer too large');
    try {
      return JSON.parse(text);
    } catch {
      throw new McpError('connector_failed', 'answer is not JSON');
    }
  }

  /** Reads events until the answer with this id; the server may send its own notes and requests first. */
  private async fromStream(
    res: Response,
    id: number,
  ): Promise<{ id?: unknown; result?: unknown; error?: { message?: unknown } }> {
    const reader = res.body?.getReader();
    if (!reader) throw new McpError('connector_failed', 'empty stream');
    const decoder = new TextDecoder();
    let buf = '';
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_MESSAGE) throw new McpError('connector_failed', 'answer too large');
        buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let cut = buf.indexOf('\n\n');
        while (cut >= 0) {
          const block = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          const data = block
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).replace(/^ /, ''))
            .join('\n');
          if (data) {
            try {
              const msg = JSON.parse(data);
              if (msg?.id === id && msg.method === undefined) return msg;
            } catch {
              // not JSON: skip
            }
          }
          cut = buf.indexOf('\n\n');
        }
      }
    } finally {
      void reader.cancel().catch(() => {});
    }
    throw new McpError('connector_failed', 'the stream ended without an answer');
  }

  notify(method: string, params?: unknown): void {
    void this.post({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }, 10_000)
      .then((r) => r.body?.cancel())
      .catch(() => {});
  }

  close(): void {
    this.dead = true;
    for (const a of this.aborts) a.abort();
    const session = this.session;
    if (session) {
      void (async () => {
        const bearer = await this.auth?.(false);
        await this.fetcher(this.url, {
          method: 'DELETE',
          redirect: 'error',
          headers: {
            ...this.headers,
            ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
            'Mcp-Session-Id': session,
          },
        });
      })().catch(() => {});
    }
  }
}

export type McpTarget =
  | { kind: 'remote'; url: string; headers: Record<string, string>; fetch?: typeof fetch; auth?: McpAuth }
  | { kind: 'local'; command: string; args: string[]; env: NodeJS.ProcessEnv; cwd?: string };

export class McpClient {
  server: { name: string; version?: string } = { name: '' };

  private constructor(private readonly t: Transport) {}

  get dead(): boolean {
    return this.t.dead;
  }

  static async connect(target: McpTarget, timeoutMs = 60_000): Promise<McpClient> {
    let http: HttpTransport | undefined;
    let t: Transport;
    if (target.kind === 'remote') {
      http = new HttpTransport(target.url, target.headers, target.fetch ?? fetch, target.auth);
      t = http;
    } else t = new StdioTransport(target.command, target.args, target.env, target.cwd);
    const client = new McpClient(t);
    try {
      const init = (await t.request(
        'initialize',
        { protocolVersion: MCP_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
        timeoutMs,
      )) as { protocolVersion?: unknown; serverInfo?: { name?: unknown; version?: unknown } } | undefined;
      if (!init || typeof init !== 'object') throw new McpError('connector_failed', 'no answer to initialize');
      if (typeof init.protocolVersion === 'string') http?.setVersion(init.protocolVersion);
      const info = init.serverInfo;
      client.server = {
        name: typeof info?.name === 'string' ? info.name.slice(0, 80) : '',
        ...(typeof info?.version === 'string' ? { version: info.version.slice(0, 40) } : {}),
      };
      t.notify('notifications/initialized');
      return client;
    } catch (e) {
      t.close();
      throw e;
    }
  }

  async tools(timeoutMs = 30_000): Promise<McpToolDef[]> {
    const out: McpToolDef[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20 && out.length < 500; page++) {
      const r = (await this.t.request('tools/list', cursor ? { cursor } : {}, timeoutMs)) as
        | { tools?: unknown; nextCursor?: unknown }
        | undefined;
      for (const raw of Array.isArray(r?.tools) ? r.tools : []) {
        const t = raw as {
          name?: unknown;
          title?: unknown;
          description?: unknown;
          inputSchema?: unknown;
          annotations?: { readOnlyHint?: unknown; title?: unknown };
        };
        if (typeof t?.name !== 'string' || !t.name || t.name.length > 128) continue;
        const title = typeof t.title === 'string' ? t.title : t.annotations?.title;
        out.push({
          name: t.name,
          ...(typeof title === 'string' && title ? { title: title.slice(0, 120) } : {}),
          description: typeof t.description === 'string' ? t.description.slice(0, 4000) : '',
          inputSchema:
            t.inputSchema && typeof t.inputSchema === 'object'
              ? (t.inputSchema as Record<string, unknown>)
              : { type: 'object' },
          readOnly: t.annotations?.readOnlyHint === true,
        });
      }
      cursor = typeof r?.nextCursor === 'string' && r.nextCursor ? r.nextCursor : undefined;
      if (!cursor) break;
    }
    return out;
  }

  async call(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<McpCallResult> {
    const r = (await this.t.request('tools/call', { name, arguments: args }, timeoutMs)) as
      | { content?: unknown; isError?: unknown; structuredContent?: unknown }
      | undefined;
    return {
      content: Array.isArray(r?.content) ? r.content : [],
      ...(r?.isError === true ? { isError: true } : {}),
      ...(r?.structuredContent !== undefined ? { structuredContent: r.structuredContent } : {}),
    };
  }

  close(): void {
    this.t.close();
  }
}
