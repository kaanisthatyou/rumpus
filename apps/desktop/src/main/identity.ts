// The device's Ed25519 key. Made on first start and sealed with safeStorage in <app>/identity.json; it signs in
// the main process for the core, so the private key never sits in the core's memory.
import { createPrivateKey, generateKeyPairSync, type KeyObject, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeStorage, type UtilityProcess } from 'electron';

interface FileShape {
  v: 1;
  publicKey: string;
  /** The PKCS#8 private key, sealed by safeStorage (base64), or in the clear where nothing can seal it. */
  sealed?: string;
  plain?: string;
}

export class Identity {
  readonly publicKey: string;
  private readonly key: KeyObject;

  constructor(appDir: string) {
    const file = join(appDir, 'identity.json');
    const loaded = existsSync(file) ? this.read(file) : undefined;
    if (loaded) {
      this.publicKey = loaded.publicKey;
      this.key = loaded.key;
      return;
    }
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    this.publicKey = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    this.key = privateKey;
    const der = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    const data: FileShape = safeStorage.isEncryptionAvailable()
      ? { v: 1, publicKey: this.publicKey, sealed: safeStorage.encryptString(der).toString('base64') }
      : { v: 1, publicKey: this.publicKey, plain: der };
    mkdirSync(appDir, { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(data), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }

  private read(file: string): { publicKey: string; key: KeyObject } | undefined {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as FileShape;
      const der = data.sealed ? safeStorage.decryptString(Buffer.from(data.sealed, 'base64')) : data.plain;
      if (!der || typeof data.publicKey !== 'string') return undefined;
      return {
        publicKey: data.publicKey,
        key: createPrivateKey({ key: Buffer.from(der, 'base64'), format: 'der', type: 'pkcs8' }),
      };
    } catch {
      // A key sealed for another user account cannot be opened: a new one is made, and certificates follow it.
      return undefined;
    }
  }

  sign(payload: string): string {
    return sign(null, Buffer.from(payload), this.key).toString('base64');
  }

  /** Serves the core's signing requests; called again for each new core process. */
  attach(core: UtilityProcess): void {
    core.postMessage({ type: 'identity', publicKey: this.publicKey });
    core.on('message', (raw: unknown) => {
      const m = raw as { type?: string; id?: number; payload?: unknown };
      if (m?.type !== 'sign' || typeof m.id !== 'number') return;
      if (typeof m.payload !== 'string' || m.payload.length > 1_000_000) {
        core.postMessage({ type: 'signed', id: m.id, error: 'bad_payload' });
        return;
      }
      core.postMessage({ type: 'signed', id: m.id, sig: this.sign(m.payload) });
    });
  }
}
