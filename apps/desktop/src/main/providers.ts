// Providers live in the main process because their keys do: sealed with safeStorage, sent only to their own
// provider. The page manages them over IPC; the core asks for completions over its parent port.
import { join } from 'node:path';
import { type Cipher, ProviderError, ProviderVault } from '@lonca/core/providers';
import { ERROR_CODES, type KeyProtection, type LlmRequest, type ProviderInput } from '@lonca/protocol';
import { safeStorage, type UtilityProcess } from 'electron';

/** Messages between the core and the main process about providers. */
export type CoreToMain =
  | { type: 'llm'; id: number; req: LlmRequest; stream?: boolean }
  | { type: 'llm:cancel'; id: number };
export type MainToCore =
  | { type: 'providers'; state: ReturnType<ProviderVault['state']> }
  | { type: 'llm:delta'; id: number; text: string }
  | { type: 'llm:done'; id: number; result: unknown }
  | { type: 'llm:error'; id: number; code: string; message: string };

const cipher: Cipher = {
  protection(): KeyProtection {
    if (!safeStorage.isEncryptionAvailable()) return 'none';
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return 'weak';
    return 'os';
  },
  encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
  decrypt: (sealed) => safeStorage.decryptString(Buffer.from(sealed, 'base64')),
};

/** Only codes the page knows how to show; anything else is `internal`. */
export function errorCode(e: unknown): string {
  const code = e instanceof ProviderError ? e.code : '';
  return (ERROR_CODES as readonly string[]).includes(code) ? code : 'internal';
}

export class Providers {
  readonly vault: ProviderVault;
  private readonly running = new Map<number, AbortController>();
  private listeners: ((state: ReturnType<ProviderVault['state']>) => void)[] = [];
  /** The current core process; replaced when the core restarts. */
  private toCore: ((m: MainToCore) => void) | undefined;

  constructor(appDir: string) {
    this.vault = new ProviderVault(join(appDir, 'providers.json'), cipher);
    this.onChange((state) => this.toCore?.({ type: 'providers', state }));
  }

  onChange(l: (state: ReturnType<ProviderVault['state']>) => void): void {
    this.listeners.push(l);
  }

  private changed(): void {
    const state = this.vault.state();
    for (const l of this.listeners) l(state);
  }

  state() {
    return this.vault.state();
  }

  save(input: unknown) {
    const i = (input ?? {}) as ProviderInput;
    const info = this.vault.save({
      ...(typeof i.id === 'string' ? { id: i.id } : {}),
      preset: String(i.preset ?? ''),
      name: String(i.name ?? ''),
      baseUrl: String(i.baseUrl ?? ''),
      ...(i.wire === 'anthropic' || i.wire === 'openai' ? { wire: i.wire } : {}),
      ...(typeof i.addKey === 'string' ? { addKey: i.addKey } : {}),
    });
    this.changed();
    return info;
  }

  remove(id: unknown) {
    this.vault.remove(String(id));
    this.changed();
  }

  removeKey(id: unknown, keyId: unknown) {
    const info = this.vault.removeKey(String(id), String(keyId));
    this.changed();
    return info;
  }

  async models(id: unknown) {
    const info = await this.vault.models(String(id));
    this.changed();
    return info;
  }

  /** Serves the core's requests; called again for each new core process. */
  attach(core: UtilityProcess): void {
    const send = (m: MainToCore) => core.postMessage(m);
    this.toCore = send;
    send({ type: 'providers', state: this.vault.state() });
    core.on('message', (raw: unknown) => {
      const m = raw as CoreToMain;
      if (m?.type === 'llm:cancel') {
        this.running.get(m.id)?.abort();
        return;
      }
      if (m?.type !== 'llm' || typeof m.id !== 'number') return;
      const ac = new AbortController();
      this.running.set(m.id, ac);
      this.vault
        .complete(m.req, {
          signal: ac.signal,
          ...(m.stream ? { onDelta: (text: string) => send({ type: 'llm:delta', id: m.id, text }) } : {}),
        })
        .then((result) => send({ type: 'llm:done', id: m.id, result }))
        .catch((e: unknown) =>
          send({ type: 'llm:error', id: m.id, code: errorCode(e), message: String((e as Error)?.message ?? e) }),
        )
        .finally(() => this.running.delete(m.id));
    });
  }
}
