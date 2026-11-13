// Web Push to paired phones (PLAN.md 5.12: "needs-attention pushes from day one"). The payload is encrypted for the
// phone's browser (RFC 8291, aes128gcm) and the request is signed with this PC's VAPID key (RFC 8292), so the push
// service carries it without reading it. No third-party library: Node's crypto does all of it.
import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  hkdfSync,
  type KeyObject,
  randomBytes,
  sign,
} from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface PushSubscription {
  endpoint: string;
  /** The browser's P-256 public key and auth secret, base64url as `PushSubscription.toJSON()` gives them. */
  keys: { p256dh: string; auth: string };
}

export interface PushMessage {
  title: string;
  body: string;
  /** Notifications with the same tag replace each other. */
  tag?: string;
}

const b64url = (b: Buffer) => b.toString('base64url');

/** The parts of a P-256 JSON Web Key kept on disk. */
interface Jwk {
  kty?: string;
  crv?: string;
  x?: string;
  y?: string;
  d?: string;
}

/** The PC's VAPID key pair, made once and kept in the app folder. */
export class Vapid {
  private readonly key: KeyObject;
  /** The public key as the browser wants it: the uncompressed P-256 point, base64url. */
  readonly publicKey: string;

  constructor(file: string) {
    let jwk: Jwk | undefined;
    if (existsSync(file)) {
      try {
        jwk = JSON.parse(readFileSync(file, 'utf8')) as Jwk;
      } catch {
        jwk = undefined;
      }
    }
    if (!jwk?.d) {
      jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' }) as Jwk;
      writeFileSync(file, JSON.stringify(jwk), { mode: 0o600 });
    }
    // Node's types call the JWK shape by a global name this project does not load: the parsed key goes in as is.
    this.key = createPrivateKey({ key: jwk as never, format: 'jwk' });
    const pub = createPublicKey(this.key).export({ format: 'jwk' });
    this.publicKey = b64url(
      Buffer.concat([
        Buffer.from([4]),
        Buffer.from(String(pub.x), 'base64url'),
        Buffer.from(String(pub.y), 'base64url'),
      ]),
    );
  }

  /** The Authorization header for one push service (its origin is the token's audience). */
  header(endpoint: string, now = Date.now()): string {
    const enc = (o: unknown) => b64url(Buffer.from(JSON.stringify(o)));
    const head = enc({ typ: 'JWT', alg: 'ES256' });
    const body = enc({
      aud: new URL(endpoint).origin,
      exp: Math.floor(now / 1000) + 12 * 60 * 60,
      sub: 'https://github.com/kaanisthatyou/rumpus',
    });
    const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: this.key, dsaEncoding: 'ieee-p1363' });
    return `vapid t=${head}.${body}.${b64url(sig)}, k=${this.publicKey}`;
  }
}

/** RFC 8291: the message body for one subscription (a single record, aes128gcm). */
export function encryptPush(payload: string, sub: PushSubscription): Buffer {
  const uaPublic = Buffer.from(sub.keys.p256dh, 'base64url');
  const authSecret = Buffer.from(sub.keys.auth, 'base64url');
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('bad subscription keys');
  const ecdh = createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const salt = randomBytes(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // The last (and only) record ends with the delimiter 0x02.
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body, cipher.getAuthTag()]);
}

/** Sends one push; `gone` means the subscription no longer exists (the phone unsubscribed or was reset). */
export async function sendPush(
  vapid: Vapid,
  sub: PushSubscription,
  message: PushMessage,
  opts: { allowHttp?: boolean } = {},
): Promise<{ ok: boolean; gone: boolean }> {
  const url = new URL(sub.endpoint);
  if (url.protocol !== 'https:' && !(opts.allowHttp && url.protocol === 'http:')) return { ok: false, gone: true };
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        authorization: vapid.header(sub.endpoint),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: '86400',
        urgency: 'high',
      },
      body: encryptPush(JSON.stringify(message), sub),
      signal: AbortSignal.timeout(15_000),
    });
    return { ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410 };
  } catch {
    return { ok: false, gone: false };
  }
}
