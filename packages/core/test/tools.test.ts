import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Advisor, Channel, LlmRequest, LlmTool } from '@lonca/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Advisors, localDay } from '../src/advisors.js';
import { type Llm, LlmError } from '../src/llm.js';
import { run } from '../src/proc.js';
import { complete } from '../src/providers/client.js';
import { READ_TOOLS, runReadTool } from '../src/readTools.js';
import { WorkspaceStore } from '../src/store.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

function project(): string {
  const dir = tmp('lonca-tools-');
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'README.md'), '# Kumbara\n\nBütçe uygulaması.\n');
  writeFileSync(join(dir, 'src', 'login.ts'), 'export function login() {\n  // TODO: hata durumu\n}\n');
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  git('add', '.');
  git('commit', '-qm', 'Login iskeleti');
  return dir;
}

describe('read tools', () => {
  it('list, read, search and look at git, all inside the folder', async () => {
    const dir = project();
    const call = (name: string, args: Record<string, unknown> = {}) => runReadTool(dir, { id: '1', name, args }, run);
    expect(await call('list_files')).toBe('src/\nREADME.md');
    expect(await call('read_file', { path: 'src/login.ts', from_line: 2, to_line: 2 })).toBe(
      '2\t  // TODO: hata durumu\n(lines 2-2 of 4)',
    );
    expect(await call('search', { text: 'todo' })).toContain('src/login.ts:2:');
    expect(await call('git_log')).toMatch(/[0-9a-f]{7} .* T: Login iskeleti/);
    expect(await call('git_show', { ref: 'HEAD' })).toContain('src/login.ts');
  });

  it('refuses paths outside the folder, symlinks out of it, bad refs and binary files', async () => {
    const dir = project();
    const outside = tmp('lonca-outside-');
    writeFileSync(join(outside, 'secret.txt'), 'gizli');
    const call = (name: string, args: Record<string, unknown>) => runReadTool(dir, { id: '1', name, args }, run);
    expect(await call('read_file', { path: '../secret.txt' })).toMatch(/^Refused/);
    expect(await call('read_file', { path: join(outside, 'secret.txt') })).toMatch(/^Refused: outside/);
    expect(await call('list_files', { path: '..' })).toMatch(/^Refused: outside/);
    try {
      symlinkSync(outside, join(dir, 'link'), 'junction');
      expect(await call('read_file', { path: 'link/secret.txt' })).toMatch(/^Refused: outside/);
    } catch {
      // creating links needs rights on some systems
    }
    expect(await call('git_show', { ref: '--output=/tmp/x' })).toMatch(/^Refused: bad ref/);
    expect(await call('git_show', { ref: 'HEAD:../../x' })).toMatch(/^Refused: bad ref/);
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([0, 1, 2]));
    expect(await call('read_file', { path: 'blob.bin' })).toBe('Refused: binary file');
    expect(await call('nope', {})).toBe('Unknown tool: nope');
    // Outside a repository, search still works by walking the folder.
    const plain = tmp('lonca-plain-');
    writeFileSync(join(plain, 'a.txt'), 'bir\niki merhaba\n');
    expect(await runReadTool(plain, { id: '1', name: 'search', args: { text: 'MERHABA' } }, run)).toBe(
      'a.txt:2:iki merhaba',
    );
  });
});

// ---------------------------------------------------------------- the wire formats with tools

let server: Server;
let base = '';
const bodies: Record<string, unknown>[] = [];

async function handler(req: IncomingMessage, res: ServerResponse) {
  let raw = '';
  for await (const c of req) raw += c;
  const body = JSON.parse(raw) as Record<string, unknown>;
  bodies.push(body);
  const json = (v: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v));
  if (req.url === '/notools/chat/completions') {
    return void res.writeHead(400).end('{"error":{"message":"this model does not support tools"}}');
  }
  const messages = (body.messages ?? []) as { role: string; content: unknown }[];
  const answered = JSON.stringify(messages).includes('tool_result') || messages.some((m) => m.role === 'tool');
  if (req.url === '/v1/chat/completions') {
    return answered
      ? json({
          choices: [{ message: { content: 'README bir bütçe uygulaması.' } }],
          usage: { prompt_tokens: 50, completion_tokens: 8 },
        })
      : json({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 40, completion_tokens: 6 },
        });
  }
  if (req.url === '/v1/messages') {
    return answered
      ? json({ content: [{ type: 'text', text: 'Tamam.' }], usage: { input_tokens: 30, output_tokens: 3 } })
      : json({
          content: [
            { type: 'text', text: 'Bakıyorum.' },
            { type: 'tool_use', id: 't1', name: 'list_files', input: {} },
            { type: 'tool_use', id: 't2', name: 'git_log', input: { count: 3 } },
          ],
          usage: { input_tokens: 20, output_tokens: 5 },
        });
  }
  res.writeHead(404).end();
}

beforeAll(async () => {
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const tool: LlmTool = READ_TOOLS[1] as LlmTool;

describe('provider client with tools', () => {
  it('speaks OpenAI tool calls and results', async () => {
    const ep = { baseUrl: `${base}/v1`, wire: 'openai' as const, keys: [] };
    const first = await complete(ep, { model: 'm', messages: [{ role: 'user', content: 'README?' }], tools: [tool] });
    expect(first.calls).toEqual([{ id: 'c1', name: 'read_file', args: { path: 'README.md' } }]);
    expect((bodies.at(-1)?.tools as unknown[])?.[0]).toMatchObject({
      type: 'function',
      function: { name: 'read_file' },
    });
    expect(bodies.at(-1)?.stream).toBeUndefined();
    const second = await complete(ep, {
      model: 'm',
      messages: [
        { role: 'user', content: 'README?' },
        { role: 'assistant', content: '', calls: first.calls },
        { role: 'tool', callId: 'c1', name: 'read_file', content: '# Kumbara' },
      ],
      tools: [tool],
    });
    expect(second).toMatchObject({ text: 'README bir bütçe uygulaması.', usage: { in: 50, out: 8 } });
    const sent = bodies.at(-1)?.messages as Record<string, unknown>[];
    expect(sent[1]).toMatchObject({ role: 'assistant', content: null, tool_calls: [{ id: 'c1' }] });
    expect(sent[2]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '# Kumbara' });
  });

  it('speaks Anthropic tool use, putting a round of results in one user turn', async () => {
    const ep = { baseUrl: `${base}/v1`, wire: 'anthropic' as const, keys: [] };
    const first = await complete(ep, {
      model: 'm',
      system: 's',
      messages: [{ role: 'user', content: 'Ne var?' }],
      tools: [tool],
    });
    expect(first.text).toBe('Bakıyorum.');
    expect(first.calls?.map((c) => c.name)).toEqual(['list_files', 'git_log']);
    expect((bodies.at(-1)?.tools as Record<string, unknown>[] | undefined)?.[0]).toMatchObject({
      name: 'read_file',
      input_schema: { type: 'object' },
    });
    const second = await complete(ep, {
      model: 'm',
      messages: [
        { role: 'user', content: 'Ne var?' },
        { role: 'assistant', content: first.text, calls: first.calls },
        { role: 'tool', callId: 't1', name: 'list_files', content: 'src/' },
        { role: 'tool', callId: 't2', name: 'git_log', content: 'abc' },
      ],
      tools: [tool],
    });
    expect(second.text).toBe('Tamam.');
    const sent = bodies.at(-1)?.messages as { role: string; content: unknown }[];
    expect(sent).toHaveLength(3);
    expect(sent[2]?.content).toEqual([
      { type: 'tool_result', tool_use_id: 't1', content: 'src/' },
      { type: 'tool_result', tool_use_id: 't2', content: 'abc' },
    ]);
  });

  it('says so when a model has no tools', async () => {
    await expect(
      complete(
        { baseUrl: `${base}/notools`, wire: 'openai', keys: [] },
        { model: 'm', messages: [{ role: 'user', content: 'x' }], tools: [tool] },
      ),
    ).rejects.toMatchObject({ code: 'provider_no_tools' });
  });
});

// ---------------------------------------------------------------- an advisor's turn with tools

function advisorSetup(
  reply: (
    req: LlmRequest,
  ) => { text: string; calls?: { id: string; name: string; args: Record<string, unknown> }[] } | Error,
) {
  const store = new WorkspaceStore(join(tmp('lonca-advtools-'), 'lonca.db'), 'dev');
  const channel: Channel = { id: 'c1', name: 'genel', kind: 'channel', topic: '', created: 1 };
  store.commit({ type: 'channel.created', data: channel });
  const folder = project();
  const advisor: Advisor = {
    id: 'a1',
    name: 'Eleştirmen',
    handle: 'elestirmen',
    personality: 'critical',
    prompt: '',
    providerId: 'p1',
    model: 'm',
    channels: [],
    chatter: 'off',
    dailyTokens: 100_000,
    folder,
    owner: 'dev',
    created: 1,
  };
  store.commit({ type: 'advisor.saved', data: advisor });
  const requests: LlmRequest[] = [];
  const llm: Llm = {
    state: () => ({
      providers: [{ id: 'p1', preset: 'groq', name: 'G', baseUrl: 'https://x', wire: 'openai', keys: [], models: [] }],
      protection: 'os',
    }),
    onChange: () => {},
    complete: async (req) => {
      requests.push(structuredClone(req));
      const r = reply(req);
      if (r instanceof Error) throw r;
      return { ...r, usage: { in: 100, out: 10 } };
    },
  };
  const messages: string[] = [];
  const advisors = new Advisors({
    store,
    llm,
    deviceId: 'dev',
    me: () => ({ id: 'dev', name: 'Kaan', language: 'tr' }),
    quietHours: () => ({ from: '00:00', to: '00:00' }),
    emitMessage: (m) => messages.push(m.text),
    emitTyping: () => {},
    emitSpend: () => {},
    emitFailed: () => {},
    addCard: () => {},
    readTool: (dir, call) => runReadTool(dir, call, run),
  });
  const ask = async (text: string) => {
    const m = {
      id: `m${Math.random()}`,
      channelId: 'c1',
      author: { kind: 'person' as const, id: 'dev', name: 'Kaan' },
      text,
      created: Date.now(),
    };
    store.commit({ type: 'message.posted', data: m });
    advisors.onMessage(m, channel);
    for (let i = 0; i < 40 && messages.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  };
  return { requests, messages, ask, store };
}

describe('advisor tools', () => {
  it('reads files through the tools before answering, and counts every round', async () => {
    const t = advisorSetup((req) =>
      req.messages.some((m) => m.role === 'tool')
        ? { text: 'login.ts içinde hata durumu hâlâ TODO.' }
        : { text: '', calls: [{ id: 'c1', name: 'read_file', args: { path: 'src/login.ts' } }] },
    );
    await t.ask('@elestirmen login ne durumda?');
    expect(t.messages).toEqual(['login.ts içinde hata durumu hâlâ TODO.']);
    expect(t.requests[0]?.tools?.map((x) => x.name)).toContain('read_file');
    expect(t.requests[0]?.system).toContain('read-only tools');
    const result = t.requests[1]?.messages.find((m) => m.role === 'tool');
    expect(result?.content).toContain('TODO: hata durumu');
    expect(t.store.spend(localDay(Date.now()))).toEqual({ a1: 220 });
  });

  it('stops calling tools after the round limit and answers anyway', async () => {
    const t = advisorSetup((req) => {
      const refused = req.messages.some(
        (m) => m.role === 'tool' && m.content.startsWith('Refused: no more tool calls'),
      );
      return refused
        ? { text: 'Yeterince baktım.' }
        : { text: '', calls: [{ id: `c${req.messages.length}`, name: 'list_files', args: {} }] };
    });
    await t.ask('@elestirmen her yere bak');
    expect(t.messages).toEqual(['Yeterince baktım.']);
    expect(t.requests).toHaveLength(5);
  });

  it('falls back to the gathered context when the model has no tools', async () => {
    const t = advisorSetup((req) => (req.tools ? new LlmError('provider_no_tools') : { text: 'Araçsız yanıt.' }));
    await t.ask('@elestirmen ?');
    expect(t.messages).toEqual(['Araçsız yanıt.']);
    expect(t.requests.map((r) => Boolean(r.tools))).toEqual([true, false]);
  });
});
