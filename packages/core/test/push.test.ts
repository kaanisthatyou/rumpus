import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encryptPush, type PushSubscription, sendPush, Vapid } from '../src/push.js';

/** What a browser does with a push it receives (RFC 8291), written independently of the sender. */
function decrypt(body: Buffer, ua: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const data = body.subarray(21 + idlen);
  const shared = ua.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
  expect(plain.at(-1)).toBe(2);
  return plain.subarray(0, plain.length - 1).toString();
}

function browser() {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = randomBytes(16);
  return { ua, auth, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
}

describe('web push', () => {
  it('encrypts a message only the subscribed browser can read', () => {
    const b = browser();
    const body = encryptPush('{"title":"Onay bekliyor"}', { endpoint: 'https://push.example/x', keys: b.keys });
    expect(decrypt(body, b.ua, b.auth)).toBe('{"title":"Onay bekliyor"}');
    const other = browser();
    expect(() => decrypt(body, other.ua, other.auth)).toThrow();
  });

  it('sends with a VAPID token the push service can check, and reports gone subscriptions', async () => {
    const vapid = new Vapid(join(mkdtempSync(join(tmpdir(), 'lonca-vapid-')), 'vapid.json'));
    const b = browser();
    const got: { auth?: string; body: Buffer; encoding?: string }[] = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      got.push({
        auth: req.headers.authorization,
        body: Buffer.concat(chunks),
        encoding: req.headers['content-encoding'] as string,
      });
      res.writeHead(req.url === '/gone' ? 410 : 201).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const sub: PushSubscription = { endpoint: `${base}/push/abc`, keys: b.keys };

    expect(await sendPush(vapid, sub, { title: 'Katılma isteği', body: 'Arda' })).toEqual({ ok: false, gone: true });
    expect(await sendPush(vapid, sub, { title: 'Katılma isteği', body: 'Arda' }, { allowHttp: true })).toEqual({
      ok: true,
      gone: false,
    });
    const sent = got[0];
    expect(sent?.encoding).toBe('aes128gcm');
    expect(JSON.parse(decrypt(sent?.body as Buffer, b.ua, b.auth))).toEqual({ title: 'Katılma isteği', body: 'Arda' });

    // The token: ES256 over header.payload with the key the header names, for this origin, not expired.
    const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(sent?.auth ?? '') ?? [];
    const [h, p, s] = String(token).split('.');
    const claims = JSON.parse(Buffer.from(String(p), 'base64url').toString());
    expect(claims.aud).toBe(base);
    expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
    const point = Buffer.from(String(key), 'base64url');
    const pub = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    });
    expect(
      verify(
        'sha256',
        Buffer.from(`${h}.${p}`),
        { key: pub, dsaEncoding: 'ieee-p1363' },
        Buffer.from(String(s), 'base64url'),
      ),
    ).toBe(true);

    expect(
      await sendPush(vapid, { ...sub, endpoint: `${base}/gone` }, { title: 'x', body: '' }, { allowHttp: true }),
    ).toEqual({
      ok: false,
      gone: true,
    });
    server.close();
  });
});
