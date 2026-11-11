import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Gateway } from '../src/gateway.js';

function post(port: number, body: unknown, headers: Record<string, string> = {}, path = '/mcp', method = 'POST') {
  return new Promise<{ status: number; json?: { result?: Record<string, unknown>; error?: { code: number } } }>(
    (resolve, reject) => {
      const data = body === undefined ? '' : JSON.stringify(body);
      const req = request(
        { host: '127.0.0.1', port, path, method, headers: { 'Content-Type': 'application/json', ...headers } },
        (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, ...(raw ? { json: JSON.parse(raw) } : {}) }));
        },
      );
      req.on('error', reject);
      req.end(data);
    },
  );
}

let gateway: Gateway | undefined;
afterEach(() => gateway?.close());

describe('Gateway', () => {
  it('answers MCP over HTTP for a valid token and knows who is calling', async () => {
    gateway = new Gateway([
      {
        name: 'whoami',
        description: 'test',
        inputSchema: { type: 'object' },
        run: (args, ctx) => [{ type: 'text', text: `${ctx.agentId}@${ctx.channelId}:${String(args.x ?? '')}` }],
      },
      {
        name: 'broken',
        description: 'test',
        inputSchema: { type: 'object' },
        run: () => {
          throw new Error('nope');
        },
      },
    ]);
    const port = await gateway.start();
    const token = gateway.issue({ agentId: 'a1', channelId: 'c1' });
    const auth = { Authorization: `Bearer ${token}` };

    const init = await post(
      port,
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
      auth,
    );
    expect(init.json?.result).toMatchObject({
      protocolVersion: '2025-11-25',
      serverInfo: { name: 'rumpus' },
      capabilities: { tools: {} },
    });
    expect((await post(port, { jsonrpc: '2.0', method: 'notifications/initialized' }, auth)).status).toBe(202);
    const list = await post(port, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, auth);
    const tools = (list.json?.result?.tools ?? []) as { name: string }[];
    expect(tools.map((t) => t.name)).toEqual(['whoami', 'broken']);
    const call = await post(
      port,
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'whoami', arguments: { x: 7 } } },
      auth,
    );
    expect(call.json?.result).toEqual({ content: [{ type: 'text', text: 'a1@c1:7' }] });
    const broken = await post(port, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'broken' } }, auth);
    expect(broken.json?.result).toMatchObject({ isError: true, content: [{ text: 'nope' }] });
    const unknown = await post(port, { jsonrpc: '2.0', id: 5, method: 'nope' }, auth);
    expect(unknown.json?.error?.code).toBe(-32601);
  });

  it('refuses missing or revoked tokens, other hosts and origins, other paths and methods', async () => {
    gateway = new Gateway([]);
    const port = await gateway.start();
    const token = gateway.issue({ agentId: 'a1', channelId: 'c1' });
    const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
    expect((await post(port, ping)).status).toBe(401);
    expect((await post(port, ping, { Authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await post(port, ping, { Authorization: `Bearer ${token}`, Host: 'evil.example' })).status).toBe(403);
    expect((await post(port, ping, { Authorization: `Bearer ${token}`, Origin: 'https://evil.example' })).status).toBe(
      403,
    );
    expect((await post(port, ping, { Authorization: `Bearer ${token}` }, '/other')).status).toBe(404);
    expect((await post(port, undefined, { Authorization: `Bearer ${token}` }, '/mcp', 'GET')).status).toBe(405);
    expect((await post(port, ping, { Authorization: `Bearer ${token}` })).status).toBe(200);
    gateway.revoke(token);
    expect((await post(port, ping, { Authorization: `Bearer ${token}` })).status).toBe(401);
  });
});
