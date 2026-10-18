// Device identity and signed events (PLAN.md, Phase 3 design). The private key stays in Electron's main process,
// which signs for the core; public keys are not secret, so the core checks signatures itself.
import { createPublicKey, sign as edSign, verify as edVerify, generateKeyPairSync, type KeyObject } from 'node:crypto';

/** An event as it travels between peers. `at` is the hybrid logical clock, `n` the author's count. */
export interface SignedEvent {
  id: string;
  author: string;
  n: number;
  at: string;
  type: string;
  data: unknown;
  sig: string;
}

/** JSON with sorted keys, so the same value always gives the same bytes. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

/** What is signed: everything but the signature, under a fixed tag. */
export function eventPayload(e: Omit<SignedEvent, 'sig'>, workspace: string): string {
  return canonical({ v: 1, ws: workspace, id: e.id, author: e.author, n: e.n, at: e.at, type: e.type, data: e.data });
}

const keyCache = new Map<string, KeyObject>();
function publicKeyOf(spkiBase64: string): KeyObject {
  let key = keyCache.get(spkiBase64);
  if (!key) {
    key = createPublicKey({ key: Buffer.from(spkiBase64, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('not an ed25519 key');
    keyCache.set(spkiBase64, key);
  }
  return key;
}

export function verifySignature(payload: string, sig: string, publicKey: string): boolean {
  try {
    return edVerify(null, Buffer.from(payload), publicKeyOf(publicKey), Buffer.from(sig, 'base64'));
  } catch {
    return false;
  }
}

export interface Signer {
  /** The device's public key (SPKI DER, base64), once known. */
  publicKey(): string | undefined;
  sign(payload: string): Promise<string>;
}

/** A signer with its key in memory: tests, and a second app instance in tests. */
export class LocalSigner implements Signer {
  private readonly keys = generateKeyPairSync('ed25519');
  publicKey(): string {
    return this.keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  }
  async sign(payload: string): Promise<string> {
    return edSign(null, Buffer.from(payload), this.keys.privateKey).toString('base64');
  }
}

/** The core side of the main process's signer, over the utility process's parent port. */
export class PortSigner implements Signer {
  private key: string | undefined;
  private next = 1;
  private readonly pending = new Map<number, { resolve: (s: string) => void; reject: (e: Error) => void }>();

  constructor(private readonly post: (message: unknown) => void) {}

  /** Feed every message from the parent port here; returns whether it was an identity message. */
  receive(m: unknown): boolean {
    const msg = m as { type?: string; id?: number; publicKey?: string; sig?: string; error?: string };
    if (msg?.type === 'identity' && typeof msg.publicKey === 'string') {
      this.key = msg.publicKey;
      return true;
    }
    if (msg?.type === 'signed' && typeof msg.id === 'number') {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (p && typeof msg.sig === 'string') p.resolve(msg.sig);
      else p?.reject(new Error(msg.error ?? 'sign_failed'));
      return true;
    }
    return false;
  }

  publicKey(): string | undefined {
    return this.key;
  }

  sign(payload: string): Promise<string> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ type: 'sign', id, payload });
    });
  }
}
