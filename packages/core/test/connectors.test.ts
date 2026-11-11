import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Channel, ConnectorsState, Frame, Job, Response, WorkspaceState } from '@lonca/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { Connectors, exposedName, noSealer, type Sealer } from '../src/connectors.js';
import type { AgentSession, DriverEvent, OpenSession, SessionOptions } from '../src/drivers/types.js';
import { toolArg } from '../src/drivers/types.js';
import { connectorEnv, McpClient } from '../src/mcp.js';
import { Core } from '../src/server.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const FAKE = fileURLToPath(new URL('./fixtures/fake-mcp.mjs', import.meta.url));
const local = (env: NodeJS.ProcessEnv) =>
  McpClient.connect({ kind: 'local', command: process.execPath, args: [FAKE], env });

/** Seals by reversing and marking: enough to see that the file never holds the value. */
const sealer: Sealer = {
  protection: () => 'os',
  seal: async (p) => `sealed:${Buffer.from(p).toString('base64').split('').reverse().join('')}`,
  open: async (s) => Buffer.from(s.slice(7).split('').reverse().join(''), 'base64').toString(),
};

const closers: (() => void)[] = [];
afterEach(() => {
  for (const c of closers.splice(0)) c();
});

describe('the MCP client', () => {
  it('talks to a program over stdio: tools with their read-only hint, calls, and errors', async () => {
    const client = await local({ ...process.env, FAKE_TOKEN: 'abc' });
    closers.push(() => client.close());
    expect(client.server).toEqual({ name: 'fake-notes', version: '1.2.3' });
    const tools = await client.tools();
    expect(tools.map((t) => [t.name, t.readOnly])).toEqual([
      ['list_notes', true],
      ['add_note', false],
    ]);
    expect(await client.call('add_note', { text: 'süt al' }, 5000)).toEqual({
      content: [{ type: 'text', text: 'added: süt al' }],
    });
    const listed = await client.call('list_notes', {}, 5000);
    expect(JSON.stringify(listed)).toContain('süt al (token=abc');
    await expect(client.call('nope', {}, 5000)).rejects.toThrow(/unknown tool nope/);
  });

  it('keeps other tools’ secrets and Rumpus’s own variables from a connector’s program', () => {
    const env = connectorEnv(
      { PATH: '/bin', GITHUB_TOKEN: 'x', OPENAI_API_KEY: 'y', LONCA_APP_DIR: 'z', HOME: '/h', MY_PASSWORD: 'p' },
      { FAKE_TOKEN: 'own' },
    );
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', FAKE_TOKEN: 'own' });
  });

  it('fails clearly when the program cannot start or ends', async () => {
    await expect(
      McpClient.connect({ kind: 'local', command: 'lonca-no-such-program', args: [], env: process.env }, 5000),
    ).rejects.toThrow(/lonca-no-such-program|exited|ENOENT/);
    await expect(
      McpClient.connect(
        {
          kind: 'local',
          command: process.execPath,
          args: ['-e', 'console.error("bad config"); process.exit(3)'],
          env: process.env,
        },
        5000,
      ),
    ).rejects.toThrow(/bad config/);
  });

  it('talks Streamable HTTP: JSON and event-stream answers, the session id, its headers, no redirects', async () => {
    const seen: { method: string; headers: IncomingMessage['headers'] }[] = [];
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (req.url === '/moved') return void res.writeHead(302, { location: '/mcp' }).end();
      if (req.method === 'DELETE') return void res.writeHead(200).end();
      let raw = '';
      for await (const c of req) raw += c;
      const m = JSON.parse(raw);
      seen.push({ method: m.method, headers: req.headers });
      if (m.id === undefined) return void res.writeHead(202).end();
      if (req.headers.authorization !== 'Bearer s3cret') return void res.writeHead(401).end('no key');
      const result =
        m.method === 'initialize'
          ? { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'uzak' } }
          : m.method === 'tools/list'
            ? { tools: [{ name: 'ara', description: 'Arar.', inputSchema: { type: 'object' } }] }
            : { content: [{ type: 'text', text: `bulundu: ${m.params.arguments.q}` }] };
      if (m.method === 'tools/call') {
        // An event stream: a progress note from the server first, then the answer.
        res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 'oturum-1' });
        res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress' })}\n\n`);
        res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result })}\n\n`);
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'oturum-1' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    closers.push(() => server.close());
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const client = await McpClient.connect({
      kind: 'remote',
      url: `${url}/mcp`,
      headers: { Authorization: 'Bearer s3cret' },
    });
    closers.push(() => client.close());
    expect(client.server.name).toBe('uzak');
    expect((await client.tools()).map((t) => t.name)).toEqual(['ara']);
    expect(await client.call('ara', { q: 'kedi' }, 5000)).toEqual({
      content: [{ type: 'text', text: 'bulundu: kedi' }],
    });
    const call = seen.find((s) => s.method === 'tools/call');
    expect(call?.headers['mcp-session-id']).toBe('oturum-1');
    expect(call?.headers['mcp-protocol-version']).toBe('2025-06-18');
    expect(seen.some((s) => s.method === 'notifications/initialized')).toBe(true);

    await expect(
      McpClient.connect({ kind: 'remote', url: `${url}/mcp`, headers: { Authorization: 'Bearer wrong' } }, 5000),
    ).rejects.toThrow(/HTTP 401: no key/);
    await expect(
      McpClient.connect({ kind: 'remote', url: `${url}/moved`, headers: { Authorization: 'Bearer s3cret' } }, 5000),
    ).rejects.toThrow();
  });

  it('names tools so that every CLI takes them, and shows them on the job card as connector.tool', () => {
    expect(exposedName('notlar', 'add_note')).toBe('notlar__add_note');
    const long = exposedName('github', 'a.very.long.tool.name.that.goes.on.and.on.for.ever');
    expect(long).toMatch(/^github__a_very_long[\w-]*_[0-9a-f]{4}$/);
    expect(long.length).toBeLessThanOrEqual(50);
    expect(toolArg('mcp__rumpus__notlar__add_note', {}, '/')).toBe('notlar.add_note');
    expect(toolArg('mcp__rumpus__add_card', {}, '/')).toBe('rumpus.add_card');
  });
});

// ---------------------------------------------------------------- through the core and the gateway

function setup() {
  const bin = tmp('lonca-bin-');
  writeFileSync(join(bin, 'claude'), '');
  const sessions: { opts: SessionOptions; emit: (e: DriverEvent) => void; disposed: boolean }[] = [];
  const open: OpenSession = (opts, emit) => {
    const s = { opts, emit, disposed: false };
    sessions.push(s);
    const session: AgentSession = {
      steering: 'live',
      busy: false,
      send: () => {},
      stop: () => {},
      dispose: () => {
        s.disposed = true;
      },
    };
    return session;
  };
  const appDir = tmp('lonca-conn-');
  const core = new Core({
    appDir,
    language: 'en',
    env: { PATH: bin, GITHUB_TOKEN: 'never-passed-on' },
    platform: 'linux',
    sealer,
    runner: async (_f, args) => ({
      code: 0,
      stdout: args[0] === '--version' ? '2.1.0' : JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }),
      stderr: '',
      timedOut: false,
    }),
    drivers: { 'claude-code': open },
    launch: (path) => ({ file: path, args: [] }),
  });
  closers.push(() => core.shutdown());
  let listener: (f: unknown) => void = () => {};
  const sent: Frame[] = [];
  core.attach({ send: (f) => sent.push(f), onFrame: (l) => (listener = l) });
  let id = 0;
  const call = async <T>(method: string, params?: unknown): Promise<T> => {
    const rid = ++id;
    listener({ id: rid, method, params });
    for (let i = 0; i < 2000; i++) {
      const r = sent.find((f) => 'id' in f && f.id === rid && ('result' in f || 'error' in f)) as Response | undefined;
      if (r) {
        if ('error' in r) throw new Error(r.error.code);
        return r.result as T;
      }
      await new Promise((res) => setTimeout(res, 5));
    }
    throw new Error(`no answer: ${method}`);
  };
  const rpc = async (mcp: SessionOptions['mcp'], method: string, params: unknown) => {
    const r = await fetch(mcp?.url ?? '', {
      method: 'POST',
      headers: { authorization: `Bearer ${mcp?.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return ((await r.json()) as { result: Record<string, unknown> }).result;
  };
  const until = async <T>(fn: () => T | undefined | false, what: string): Promise<T> => {
    for (let i = 0; i < 500; i++) {
      const v = fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timed out: ${what}`);
  };
  /** Saving answers at once; the test that follows ends with a `connectors.changed`. */
  const settled = async () => {
    for (let i = 0; i < 1000; i++) {
      const state = await call<ConnectorsState>('connectors.list');
      if (state.connectors.every((c) => c.state !== 'testing')) return state;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timed out: connector test');
  };
  const jobs = () =>
    sent.filter((f): f is { event: 'job.updated'; data: Job } => 'event' in f && f.event === 'job.updated');
  return { appDir, call, sessions, rpc, until, jobs, settled };
}

describe('connectors through the gateway', () => {
  it('serves a connector to the agents allowed, by policy, with its secret sealed on disk', async () => {
    const { appDir, call, sessions, rpc, until, jobs, settled } = setup();
    const agent = await call<{ id: string }>('agents.save', {
      kind: 'claude-code',
      name: 'Ana',
      handle: 'ana',
      folder: tmp('lonca-a-'),
      mode: 'edit',
    });
    const saved = await call<ConnectorsState>('connectors.save', {
      name: 'Notlar',
      kind: 'local',
      command: process.execPath,
      args: [FAKE],
      secrets: [{ name: 'FAKE_TOKEN', value: 'tok-123456789' }],
      agents: [agent.id],
    });
    expect(saved.connectors[0]?.state).toBe('testing');
    let state = await settled();
    const conn = state.connectors[0];
    expect(conn).toMatchObject({
      name: 'Notlar',
      slug: 'notlar',
      state: 'ok',
      server: { name: 'fake-notes', version: '1.2.3' },
      secrets: [{ name: 'FAKE_TOKEN', hint: '…6789' }],
      tools: [
        { name: 'list_notes', readOnly: true, policy: 'allow' },
        { name: 'add_note', readOnly: false, policy: 'ask' },
      ],
    });
    expect(readFileSync(join(appDir, 'connectors.json'), 'utf8')).not.toContain('tok-123456789');

    const ws = await call<WorkspaceState>('workspace.get');
    const genel = (ws.channels.find((c) => c.kind === 'channel') as Channel).id;
    await call('messages.send', { channelId: genel, text: '@ana notlara bak' });
    const s = await until(() => sessions[0], 'session');
    const listed = (await rpc(s.opts.mcp, 'tools/list', {})).tools as { name: string }[];
    expect(listed.map((t) => t.name)).toEqual(expect.arrayContaining(['notlar__list_notes', 'notlar__add_note']));

    // `allow` runs at once; the secret reached the program and other tools' secrets did not.
    const read = await rpc(s.opts.mcp, 'tools/call', { name: 'notlar__list_notes', arguments: {} });
    expect(JSON.stringify(read)).toContain('no notes (token=tok-123456789 leaked=no)');

    // `ask` waits on the job card until a person answers.
    const asked = rpc(s.opts.mcp, 'tools/call', { name: 'notlar__add_note', arguments: { text: 'ekmek' } });
    const waiting = await until(() => jobs().find((j) => j.data.state === 'attention')?.data, 'approval shown');
    expect(waiting.approval).toMatchObject({ label: 'connector', arg: 'Notlar: add_note', detail: '{"text":"ekmek"}' });
    await call('jobs.answer', { id: waiting.id, allow: true });
    expect(JSON.stringify(await asked)).toContain('added: ekmek');

    // Denied: the agent hears it, the card records it.
    const denied = rpc(s.opts.mcp, 'tools/call', { name: 'notlar__add_note', arguments: { text: 'peynir' } });
    const second = await until(
      () => jobs().find((j) => j.data.state === 'attention' && j.data.approval?.detail?.includes('peynir'))?.data,
      'second approval',
    );
    await call('jobs.answer', { id: second.id, allow: false });
    expect(await denied).toMatchObject({ isError: true });

    // `once`: asked the first time in a job only.
    state = await call<ConnectorsState>('connectors.policy', { id: conn?.id, tool: 'add_note', policy: 'once' });
    const first = rpc(s.opts.mcp, 'tools/call', { name: 'notlar__add_note', arguments: { text: 'bir' } });
    const third = await until(
      () => jobs().find((j) => j.data.state === 'attention' && j.data.approval?.detail?.includes('bir'))?.data,
      'once approval',
    );
    await call('jobs.answer', { id: third.id, allow: true });
    await first;
    expect(
      JSON.stringify(await rpc(s.opts.mcp, 'tools/call', { name: 'notlar__add_note', arguments: { text: 'iki' } })),
    ).toContain('added: iki');

    // Blocked tools disappear, and the next message starts the CLI again with the new list.
    await call('connectors.policy', { id: conn?.id, tool: 'add_note', policy: 'blocked' });
    s.emit({ type: 'end', ok: true, final: 'tamam' });
    await call('messages.send', { channelId: genel, text: '@ana tekrar' });
    const again = await until(() => sessions[1], 'restarted session');
    expect(s.disposed).toBe(true);
    const now = (await rpc(again.opts.mcp, 'tools/list', {})).tools as { name: string }[];
    expect(now.map((t) => t.name)).toContain('notlar__list_notes');
    expect(now.map((t) => t.name)).not.toContain('notlar__add_note');

    // Not allowed for an agent: it does not see the connector.
    const other = await call<{ id: string }>('agents.save', {
      kind: 'claude-code',
      name: 'Diğer',
      handle: 'diger',
      folder: tmp('lonca-b-'),
      mode: 'read',
    });
    await call('messages.send', { channelId: genel, text: '@diger merhaba' });
    const o = await until(() => sessions.find((x) => x.opts.cwd !== s.opts.cwd), 'other session');
    const theirs = (await rpc(o.opts.mcp, 'tools/list', {})).tools as { name: string }[];
    expect(theirs.some((t) => t.name.startsWith('notlar__'))).toBe(false);
    expect(other.id).toBeTruthy();
  });

  it('refuses bad input and secrets without a way to seal them, and records a failed test', async () => {
    const { call, settled } = setup();
    await expect(call('connectors.save', { name: '', kind: 'local', command: 'x' })).rejects.toThrow(
      'invalid_connector',
    );
    await expect(
      call('connectors.save', { name: 'Uzak', kind: 'remote', url: 'http://example.com/mcp' }),
    ).rejects.toThrow('invalid_connector');
    await expect(
      call('connectors.save', { name: 'X', kind: 'local', command: 'x', secrets: [{ name: 'bad name', value: 'v' }] }),
    ).rejects.toThrow('invalid_connector');
    await call<ConnectorsState>('connectors.save', {
      name: 'Bozuk',
      kind: 'local',
      command: process.execPath,
      args: ['-e', 'console.error("missing config"); process.exit(1)'],
    });
    const state = await settled();
    expect(state.connectors[0]).toMatchObject({ state: 'failed', error: 'connector_failed' });
    expect(state.connectors[0]?.detail).toContain('missing config');
    const removed = await call<ConnectorsState>('connectors.remove', { id: state.connectors[0]?.id });
    expect(removed.connectors).toEqual([]);
  });
});

describe('the registry search', () => {
  it('asks for the latest versions by name, drops inactive entries, and names a failure', async () => {
    const asked: string[] = [];
    const answer = {
      servers: [
        {
          server: { name: 'io.example/a', description: 'A' },
          _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active' } },
        },
        {
          server: { name: 'io.example/old' },
          _meta: { 'io.modelcontextprotocol.registry/official': { status: 'deprecated' } },
        },
        { server: { name: '' } },
      ],
      metadata: { nextCursor: 'io.example/a:1.0.0' },
    };
    const fake = (async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify(answer), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const connectors = new Connectors(join(tmp('lonca-reg-'), 'c.json'), noSealer, { fetch: fake });
    const found = await connectors.search('example', 'c1');
    expect(found).toEqual({
      servers: [{ name: 'io.example/a', description: 'A', remotes: [], packages: [] }],
      next: 'io.example/a:1.0.0',
    });
    expect(asked[0]).toBe(
      'https://registry.modelcontextprotocol.io/v0.1/servers?version=latest&limit=30&search=example&cursor=c1',
    );
    const down = new Connectors(join(tmp('lonca-reg-'), 'c.json'), noSealer, {
      fetch: (async () => new Response('busy', { status: 503 })) as typeof fetch,
    });
    await expect(down.search('x')).rejects.toThrow('registry_unreachable');
  });
});
