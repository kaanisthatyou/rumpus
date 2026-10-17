// Lonca's own MCP server for the agents it runs (PLAN.md 5.3, 5.9): a small Streamable HTTP endpoint on
// 127.0.0.1 that answers JSON-RPC with plain JSON (no SSE stream). Each agent session gets its own bearer token,
// which says who is calling; tools act only within that agent's workspace. Connectors from the store will be
// served through the same endpoint later.
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ToolContext {
  agentId: string;
  channelId: string;
}

export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolContent[]> | ToolContent[];
}

const SERVER_INFO = { name: 'lonca', version: '0.2.0' };
const MAX_BODY = 1024 * 1024;

export class Gateway {
  private server: Server | undefined;
  private port = 0;
  private readonly tokens = new Map<string, ToolContext>();
  /** Requests that came with a valid token (for tests and diagnostics). */
  served = 0;

  constructor(private readonly tools: Tool[]) {}

  async start(): Promise<number> {
    if (this.server) return this.port;
    const server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    this.server = server;
    this.port = (server.address() as AddressInfo).port;
    return this.port;
  }

  url(): string {
    return `http://127.0.0.1:${this.port}/mcp`;
  }

  issue(ctx: ToolContext): string {
    const token = randomBytes(24).toString('base64url');
    this.tokens.set(token, ctx);
    return token;
  }

  revoke(token: string): void {
    this.tokens.delete(token);
  }

  close(): void {
    this.server?.close();
    this.server = undefined;
    this.tokens.clear();
  }

  private send(res: ServerResponse, status: number, body?: unknown): void {
    res.writeHead(status, body === undefined ? {} : { 'Content-Type': 'application/json' });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Only this computer, only the expected host (no DNS rebinding), only with a token Lonca handed out.
    if (req.headers.host !== `127.0.0.1:${this.port}` || req.headers.origin) return this.send(res, 403);
    if ((req.url ?? '').split('?')[0] !== '/mcp') return this.send(res, 404);
    if (req.method !== 'POST') return this.send(res, 405);
    const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
    const ctx = token ? this.tokens.get(token) : undefined;
    if (!ctx) return this.send(res, 401);
    this.served += 1;

    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY) return this.send(res, 413);
    }
    let msg: { jsonrpc?: string; id?: string | number; method?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(raw);
    } catch {
      return this.send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    }
    if (msg.id === undefined) return this.send(res, 202); // a notification
    const reply = (result: unknown) => this.send(res, 200, { jsonrpc: '2.0', id: msg.id, result });
    const fail = (code: number, message: string) =>
      this.send(res, 200, { jsonrpc: '2.0', id: msg.id, error: { code, message } });

    switch (msg.method) {
      case 'initialize':
        return reply({
          protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions: 'Lonca workspace tools: channel history, records, the task board, progress notes.',
        });
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({
          tools: this.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        });
      case 'tools/call': {
        const tool = this.tools.find((t) => t.name === msg.params?.name);
        if (!tool) return fail(-32602, 'unknown tool');
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        try {
          return reply({ content: await tool.run(args, ctx) });
        } catch (err) {
          const text = err instanceof Error ? err.message : String(err);
          return reply({ content: [{ type: 'text', text }], isError: true });
        }
      }
      default:
        return fail(-32601, 'method not found');
    }
  }
}
