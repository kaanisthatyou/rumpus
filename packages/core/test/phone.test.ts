import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Frame, PhoneState, Response } from '@lonca/protocol';
import { afterAll, describe, expect, it } from 'vitest';
import { Core } from '../src/server.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
let step = 0;
/** fetch with the step number in its error, so a failure says where it happened. */
async function get(url: string, init?: RequestInit): Promise<globalThis.Response> {
  step += 1;
  try {
    return await fetch(url, init);
  } catch (e) {
    throw new Error(`request ${step} to ${url} failed: ${String((e as { cause?: unknown }).cause ?? e)}`);
  }
}
const cores: Core[] = [];
afterAll(() => {
  for (const c of cores) c.shutdown();
});

function setup() {
  const web = tmp('lonca-web-');
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>Rumpus</title>');
  writeFileSync(join(web, 'app.js'), 'console.log(1)');
  const appDir = tmp('lonca-phone-');
  writeFileSync(join(appDir, 'secret.txt'), 'gizli');
  const core = new Core({
    appDir,
    language: 'tr',
    env: { PATH: '' },
    platform: 'linux',
    web: { dir: web, port: 0, https: false },
  });
  cores.push(core);
  let listener: (f: unknown) => void = () => {};
  const sent: Frame[] = [];
  core.attach({ send: (f) => sent.push(f), onFrame: (l) => (listener = l) });
  let id = 0;
  const call = async <T>(method: string, params?: unknown): Promise<T> => {
    const rid = ++id;
    listener({ id: rid, method, params });
    for (let i = 0; i < 400; i++) {
      const r = sent.find((f) => 'id' in f && f.id === rid && ('result' in f || 'error' in f)) as Response | undefined;
      if (r) {
        if ('error' in r) throw new Error(r.error.code);
        return r.result as T;
      }
      await new Promise((res) => setTimeout(res, 5));
    }
    throw new Error(`no answer: ${method}`);
  };
  return { core, call, sent };
}

describe('phone companion', () => {
  it('pairs a phone with a one-time code, answers its requests and streams events, and cuts it off on revoke', async () => {
    const { call, sent } = setup();
    expect((await call<PhoneState>('phones.state')).on).toBe(false);
    await expect(call('phones.pair')).rejects.toThrow('no_address');
    await call('settings.update', { phone: true });
    const state = await call<PhoneState>('phones.state');
    expect(state.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const base = state.url as string;

    // The page itself is served to anyone in the tailnet; data needs a key.
    expect(await (await get(`${base}/`)).text()).toContain('<title>Rumpus</title>');
    expect(await (await get(`${base}/kanal/genel`)).text()).toContain('<title>Rumpus</title>');
    expect(await (await get(`${base}/..%2Fsecret.txt`)).text()).not.toContain('gizli');
    const frame = { id: 1, method: 'settings.get' };
    expect(
      (await get(`${base}/api/frame`, { method: 'POST', headers: { 'x-lonca': '1' }, body: JSON.stringify(frame) }))
        .status,
    ).toBe(401);

    // Pairing: the code from the QR works once.
    const { url } = await call<{ url: string }>('phones.pair');
    const code = new URL(url).searchParams.get('pair');
    const pair = (c: string | null, headers: Record<string, string> = { 'x-lonca': '1' }) =>
      get(`${base}/api/pair`, { method: 'POST', headers, body: JSON.stringify({ code: c, name: 'Pixel' }) });
    expect((await pair(code, {})).status).toBe(403);
    const paired = await pair(code);
    expect(paired.status).toBe(200);
    expect(paired.headers.get('set-cookie')).toMatch(/^lonca_phone=[\w-]+; HttpOnly; SameSite=Strict/);
    const { token } = (await paired.json()) as { token: string };
    expect((await pair(code)).status).toBe(403);
    // The window hears of the new phone without asking.
    expect(
      sent.some(
        (f) => 'event' in f && f.event === 'phones.changed' && (f.data as PhoneState).phones[0]?.name === 'Pixel',
      ),
    ).toBe(true);

    // Requests with the key (header or cookie); writes need the header that cross-site pages cannot send.
    const ask = (body: unknown, headers: Record<string, string>) =>
      get(`${base}/api/frame`, { method: 'POST', headers, body: JSON.stringify(body) });
    const answer = (await (await ask(frame, { 'x-lonca': '1', 'x-lonca-phone': token })).json()) as Response;
    expect(answer).toMatchObject({ id: 1, result: { phone: true } });
    expect((await ask(frame, { 'x-lonca': '1', cookie: `lonca_phone=${token}` })).status).toBe(200);
    expect((await ask(frame, { 'x-lonca-phone': token })).status).toBe(403);
    expect((await ask(frame, { 'x-lonca': '1', 'x-lonca-phone': token, origin: 'https://evil.example' })).status).toBe(
      403,
    );

    // Events reach the phone as they reach the window.
    const ac = new AbortController();
    const stream = await get(`${base}/api/events?k=${token}`, { signal: ac.signal });
    const reader = (stream.body as ReadableStream<Uint8Array>).getReader();
    await call('settings.update', { accent: 'blue' });
    let seen = '';
    for (let i = 0; i < 10 && !seen.includes('settings.changed'); i++)
      seen += new TextDecoder().decode((await reader.read()).value);
    expect(seen).toContain('"accent":"blue"');
    ac.abort();

    const phones = (await call<PhoneState>('phones.state')).phones;
    expect(phones).toMatchObject([{ name: 'Pixel' }]);
    await call('phones.revoke', { id: phones[0]?.id });
    expect((await ask(frame, { 'x-lonca': '1', 'x-lonca-phone': token })).status).toBe(401);

    await call('settings.update', { phone: false });
    expect((await call<PhoneState>('phones.state')).url).toBeUndefined();
    await expect(fetch(`${base}/api/ping`)).rejects.toThrow();
  });
});

describe('phone pushes', () => {
  it('pushes to a subscribed phone that is not looking, never to one that is, and forgets dead subscriptions', async () => {
    const { PhoneServer } = await import('../src/phone.js');
    const { createECDH, randomBytes } = await import('node:crypto');
    const { createServer } = await import('node:http');
    const received: { path: string; size: number }[] = [];
    let status = 201;
    const service = createServer(async (req, res) => {
      let size = 0;
      for await (const c of req) size += (c as Buffer).length;
      received.push({ path: req.url ?? '', size });
      res.writeHead(status).end();
    });
    await new Promise<void>((r) => service.listen(0, '127.0.0.1', r));
    const pushBase = `http://127.0.0.1:${(service.address() as { port: number }).port}`;

    const dir = tmp('lonca-push-');
    const host = { answer: async () => ({ id: 0, result: {} }) as Frame, subscribe: () => () => {} };
    const server = new PhoneServer(join(dir, 'phones.json'), host, undefined, { allowHttpPush: true });
    const port = await server.listen(0);
    const base = `http://127.0.0.1:${port}`;
    const { code } = server.pairingCode();
    const paired = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: { 'x-lonca': '1' },
      body: JSON.stringify({ code }),
    });
    const { token } = (await paired.json()) as { token: string };
    const headers = { 'x-lonca': '1', 'x-lonca-phone': token };
    const key = (await (await fetch(`${base}/api/push-key`, { headers })).json()) as { key: string };
    expect(Buffer.from(key.key, 'base64url')).toHaveLength(65);

    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const subscription = {
      endpoint: `${pushBase}/sub/1`,
      keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
    };
    const bad = await fetch(`${base}/api/push`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ subscription: { endpoint: 'nope' } }),
    });
    expect(bad.status).toBe(400);
    expect(
      (await fetch(`${base}/api/push`, { method: 'POST', headers, body: JSON.stringify({ subscription }) })).status,
    ).toBe(200);
    expect(server.phones()[0]?.push).toBe(true);

    expect(await server.notify({ title: 'Onay bekliyor', body: 'Claude' })).toBe(1);
    expect(received).toMatchObject([{ path: '/sub/1' }]);

    // While the phone has the app open, no push.
    const ac = new AbortController();
    await fetch(`${base}/api/events?k=${token}`, { signal: ac.signal });
    expect(await server.notify({ title: 'x', body: '' })).toBe(0);
    ac.abort();
    await new Promise((r) => setTimeout(r, 100));

    // A subscription the push service no longer knows is dropped.
    status = 410;
    expect(await server.notify({ title: 'x', body: '' })).toBe(0);
    expect(server.phones()[0]?.push).toBe(false);
    server.close();
    service.close();
  });
});
