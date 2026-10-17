import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { providerUrlAllowed } from '@lonca/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { complete, listModels, ProviderError, parseModels } from '../src/providers/client.js';
import { type Cipher, ProviderVault } from '../src/providers/vault.js';

// A stand-in provider: `good` is the only accepted key, `busy` gets 429, and paths decide the wire.
interface Seen {
  path: string;
  auth?: string;
  body?: Record<string, unknown>;
}
let server: Server;
let base = '';
const seen: Seen[] = [];
let refuseStreamOptions = false;

function sse(res: ServerResponse, events: unknown[]) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(`data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`);
  res.end();
}

async function handler(req: IncomingMessage, res: ServerResponse) {
  let raw = '';
  for await (const c of req) raw += c;
  const auth =
    (req.headers.authorization as string | undefined)?.replace('Bearer ', '') ??
    (req.headers['x-api-key'] as string | undefined);
  const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
  seen.push({ path: req.url ?? '', ...(auth ? { auth } : {}), ...(body ? { body } : {}) });
  if (auth === 'busy') return void res.writeHead(429).end('{"error":{"message":"slow down"}}');
  if (auth !== 'good' && !req.url?.startsWith('/open/')) return void res.writeHead(401).end('{"error":"bad key"}');
  const path = req.url?.replace(/^\/(open|v1)/, '') ?? '';
  if (path.startsWith('/models')) {
    return void res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ data: [{ id: 'models/zeta' }, { id: 'alpha' }, { id: 'alpha' }] }));
  }
  if (path === '/chat/completions') {
    if (refuseStreamOptions && body?.stream_options) {
      return void res.writeHead(400).end('{"error":{"message":"unknown field stream_options"}}');
    }
    return sse(res, [
      { choices: [{ delta: { role: 'assistant' } }] },
      { choices: [{ delta: { content: 'Mer' } }] },
      { choices: [{ delta: { content: 'haba' } }] },
      ...(body?.stream_options ? [{ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } }] : []),
      '[DONE]',
    ]);
  }
  if (path === '/messages') {
    return sse(res, [
      { type: 'message_start', message: { usage: { input_tokens: 9, cache_read_input_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Sel' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'am' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
      { type: 'message_stop' },
    ]);
  }
  res.writeHead(404).end();
}

beforeAll(async () => {
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const msgs = [{ role: 'user' as const, content: 'selam' }];

describe('provider client', () => {
  it('streams an OpenAI-style answer with usage, sending the system prompt first', async () => {
    const deltas: string[] = [];
    const r = await complete(
      { baseUrl: `${base}/v1`, wire: 'openai', keys: ['good'] },
      { model: 'm', system: 'kısa yanıtla', messages: msgs, onDelta: (d) => deltas.push(d) },
    );
    expect(r).toEqual({ text: 'Merhaba', usage: { in: 12, out: 3 }, index: 0 });
    expect(deltas).toEqual(['Mer', 'haba']);
    const sent = seen.at(-1)?.body as { messages: { role: string }[] };
    expect(sent.messages.map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('asks again without stream_options when a server refuses them, and estimates usage', async () => {
    refuseStreamOptions = true;
    const r = await complete({ baseUrl: `${base}/v1`, wire: 'openai', keys: ['good'] }, { model: 'm', messages: msgs });
    refuseStreamOptions = false;
    expect(r.text).toBe('Merhaba');
    expect(r.usage.estimated).toBe(true);
  });

  it('streams an Anthropic answer, counting cached input', async () => {
    const r = await complete(
      { baseUrl: `${base}/v1`, wire: 'anthropic', keys: ['good'] },
      { model: 'claude-haiku', system: 's', messages: msgs },
    );
    expect(r).toEqual({ text: 'Selam', usage: { in: 10, out: 2 }, index: 0 });
    const sent = seen.at(-1)?.body as { system?: string; max_tokens?: number };
    expect(sent.system).toBe('s');
    expect(sent.max_tokens).toBe(1024);
  });

  it('moves along the key chain on 401 and 429 and reports which key worked', async () => {
    const r = await complete(
      { baseUrl: `${base}/v1`, wire: 'openai', keys: ['wrong', 'busy', 'good'] },
      { model: 'm', messages: msgs },
    );
    expect(r.index).toBe(2);
    await expect(
      complete({ baseUrl: `${base}/v1`, wire: 'openai', keys: ['wrong', 'busy'] }, { model: 'm', messages: msgs }),
    ).rejects.toMatchObject({ code: 'provider_rate_limited' });
    await expect(
      complete({ baseUrl: `${base}/v1`, wire: 'openai', keys: ['wrong'] }, { model: 'm', messages: msgs }),
    ).rejects.toMatchObject({ code: 'provider_auth' });
    await expect(
      complete({ baseUrl: `${base}/v1`, wire: 'openai', keys: [] }, { model: 'm', messages: msgs }),
    ).rejects.toMatchObject({ code: 'provider_no_key' });
  });

  it('lists models in a tolerant way, without auth for open servers', async () => {
    expect((await listModels({ baseUrl: `${base}/open`, wire: 'openai', keys: [] })).models).toEqual(['alpha', 'zeta']);
    expect(parseModels({ models: [{ name: 'models/gemini-x' }, 'b'] })).toEqual(['b', 'gemini-x']);
    expect(parseModels(null)).toEqual([]);
    const anth = await listModels({ baseUrl: `${base}/v1`, wire: 'anthropic', keys: ['good'] });
    expect(anth.models).toEqual(['alpha', 'zeta']);
    expect(seen.at(-1)?.path).toBe('/v1/models?limit=1000');
  });

  it('turns network failures, timeouts and cancels into codes', async () => {
    await expect(listModels({ baseUrl: 'http://127.0.0.1:9/v1', wire: 'openai', keys: [] })).rejects.toBeInstanceOf(
      ProviderError,
    );
    const ac = new AbortController();
    ac.abort();
    await expect(
      complete(
        { baseUrl: `${base}/v1`, wire: 'openai', keys: ['good'] },
        { model: 'm', messages: msgs, signal: ac.signal },
      ),
    ).rejects.toMatchObject({ code: 'provider_cancelled' });
  });
});

describe('provider urls', () => {
  it('allows https anywhere and plain http only nearby', () => {
    expect(providerUrlAllowed('https://api.groq.com/openai/v1')).toBe(true);
    expect(providerUrlAllowed('http://127.0.0.1:11434/v1')).toBe(true);
    expect(providerUrlAllowed('http://localhost:1234/v1')).toBe(true);
    expect(providerUrlAllowed('http://192.168.1.20:8080/v1')).toBe(true);
    expect(providerUrlAllowed('http://100.101.102.103:4000')).toBe(true);
    expect(providerUrlAllowed('http://api.example.com/v1')).toBe(false);
    expect(providerUrlAllowed('http://8.8.8.8/v1')).toBe(false);
    expect(providerUrlAllowed('https://user:pass@example.com')).toBe(false);
    expect(providerUrlAllowed('file:///etc/passwd')).toBe(false);
    expect(providerUrlAllowed('nonsense')).toBe(false);
  });
});

describe('ProviderVault', () => {
  const cipher = (protection: 'os' | 'none' = 'os'): Cipher => ({
    protection: () => protection,
    encrypt: (s) => `sealed:${Buffer.from(s).toString('base64')}`,
    decrypt: (s) => Buffer.from(s.replace('sealed:', ''), 'base64').toString(),
  });

  it('keeps providers and sealed keys on disk, shows only hints, and uses the chain', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'lonca-vault-')), 'providers.json');
    const vault = new ProviderVault(file, cipher());
    const p = vault.save({ preset: 'custom', name: 'Yerel', baseUrl: `${base}/v1/`, addKey: 'busy' });
    vault.save({ id: p.id, preset: 'custom', name: 'Yerel', baseUrl: `${base}/v1`, addKey: 'xx-good' });
    expect(readFileSync(file, 'utf8')).not.toContain('xx-good');
    const info = vault.state().providers[0];
    expect(info?.keys.map((k) => k.hint)).toEqual(['busy', 'good']);
    expect(JSON.stringify(vault.state())).not.toContain('sealed');

    // The server accepts only "good"; the vault's second key is "xx-good", so both fail: auth over rate limit.
    await expect(vault.complete({ providerId: p.id, model: 'm', messages: msgs })).rejects.toMatchObject({
      code: 'provider_rate_limited',
    });
    const again = new ProviderVault(file, cipher());
    const fixed = again.save({ id: p.id, preset: 'custom', name: 'Yerel', baseUrl: `${base}/v1`, addKey: 'good' });
    const r = await again.complete({ providerId: p.id, model: 'm', messages: msgs });
    expect(r.text).toBe('Merhaba');
    expect((await again.models(fixed.id)).models).toEqual(['alpha', 'zeta']);
    again.removeKey(p.id, fixed.keys[0]?.id ?? '');
    expect(again.info(p.id)?.keys).toHaveLength(2);
    again.remove(p.id);
    expect(new ProviderVault(file, cipher()).state().providers).toEqual([]);
  });

  it('refuses bad addresses, keys and storing keys without protection', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'lonca-vault-')), 'providers.json');
    const vault = new ProviderVault(file, cipher('none'));
    expect(() => vault.save({ preset: 'custom', name: 'x', baseUrl: 'http://example.com/v1' })).toThrow(
      expect.objectContaining({ code: 'provider_bad_url' }),
    );
    expect(() =>
      vault.save({ preset: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', addKey: 'k' }),
    ).toThrow(expect.objectContaining({ code: 'provider_storage' }));
    const open = new ProviderVault(join(mkdtempSync(join(tmpdir(), 'lonca-vault-')), 'p.json'), cipher());
    expect(() =>
      open.save({ preset: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', addKey: 'a b' }),
    ).toThrow(expect.objectContaining({ code: 'provider_bad_key' }));
  });

  it('needs a key for presets that need one', async () => {
    const vault = new ProviderVault(join(mkdtempSync(join(tmpdir(), 'lonca-vault-')), 'p.json'), cipher());
    const g = vault.save({ preset: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' });
    await expect(vault.models(g.id)).rejects.toMatchObject({ code: 'provider_no_key' });
  });
});
