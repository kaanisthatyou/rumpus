// The provider list and its keys, kept in one file in the app folder. Keys are encrypted by the caller's cipher
// (Electron's safeStorage in the main process) and never leave this object in plain text except to be sent to
// their own provider.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  type KeyProtection,
  type LlmMessage,
  type LlmResult,
  type LlmTool,
  type ProviderInfo,
  type ProviderInput,
  type ProvidersState,
  presetOf,
  providerUrlAllowed,
} from '@lonca/protocol';
import { newId } from '../ids.js';
import { complete, type Endpoint, listModels, ProviderError } from './client.js';

export interface Cipher {
  protection(): KeyProtection;
  encrypt(plain: string): string;
  decrypt(sealed: string): string;
}

interface StoredKey {
  id: string;
  hint: string;
  added: number;
  sealed: string;
}

interface Stored extends Omit<ProviderInfo, 'keys'> {
  keys: StoredKey[];
  /** The key that worked last. */
  good?: number;
}

interface FileShape {
  v: 1;
  providers: Stored[];
}

export class ProviderVault {
  private list: Stored[] = [];

  constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
  ) {
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8')) as FileShape;
        if (data.v === 1 && Array.isArray(data.providers)) this.list = data.providers;
      } catch {
        // A damaged file starts over; the keys in it could not be read anyway.
      }
    }
  }

  state(): ProvidersState {
    return { providers: this.list.map(publicInfo), protection: this.cipher.protection() };
  }

  info(id: string): ProviderInfo | undefined {
    const p = this.list.find((x) => x.id === id);
    return p && publicInfo(p);
  }

  save(input: ProviderInput): ProviderInfo {
    const name = String(input.name ?? '')
      .trim()
      .slice(0, 40);
    const baseUrl = String(input.baseUrl ?? '')
      .trim()
      .replace(/\/+$/, '');
    const preset = presetOf(input.preset);
    if (!preset || !name) throw new ProviderError('bad_request');
    if (!providerUrlAllowed(baseUrl)) throw new ProviderError('provider_bad_url');
    const wire = preset.id === 'custom' ? (input.wire === 'anthropic' ? 'anthropic' : 'openai') : preset.wire;
    let p = input.id ? this.list.find((x) => x.id === input.id) : undefined;
    if (input.id && !p) throw new ProviderError('not_found');
    if (!p) {
      p = { id: newId(), preset: preset.id, name, baseUrl, wire, keys: [], models: [] };
      this.list.push(p);
    } else {
      // A new address or protocol makes the fetched model list stale.
      if (p.baseUrl !== baseUrl || p.wire !== wire) {
        p.models = [];
        delete p.modelsAt;
      }
      Object.assign(p, { name, baseUrl, wire });
    }
    const key = String(input.addKey ?? '').trim();
    if (key) {
      if (this.cipher.protection() === 'none') throw new ProviderError('provider_storage');
      if (key.length > 400 || /\s/.test(key)) throw new ProviderError('provider_bad_key');
      p.keys.push({ id: newId(), hint: key.slice(-4), added: Date.now(), sealed: this.cipher.encrypt(key) });
    }
    this.write();
    return publicInfo(p);
  }

  remove(id: string): void {
    this.list = this.list.filter((p) => p.id !== id);
    this.write();
  }

  removeKey(id: string, keyId: string): ProviderInfo {
    const p = this.get(id);
    p.keys = p.keys.filter((k) => k.id !== keyId);
    p.good = 0;
    this.write();
    return publicInfo(p);
  }

  /** Fetches the model list (costs no tokens) and keeps it. */
  async models(id: string, signal?: AbortSignal): Promise<ProviderInfo> {
    const p = this.get(id);
    const { models, index } = await listModels(this.endpoint(p), signal ? { signal } : {});
    p.models = models.slice(0, 2000);
    p.modelsAt = Date.now();
    p.good = index;
    this.write();
    return publicInfo(p);
  }

  async complete(
    req: {
      providerId: string;
      model: string;
      system?: string;
      messages: LlmMessage[];
      tools?: LlmTool[];
      maxTokens?: number;
      temperature?: number;
    },
    opts: { signal?: AbortSignal; onDelta?: (text: string) => void } = {},
  ): Promise<LlmResult> {
    const p = this.get(req.providerId);
    const { index, ...result } = await complete(this.endpoint(p), {
      model: req.model,
      messages: req.messages,
      ...(req.tools?.length ? { tools: req.tools } : {}),
      ...(req.system ? { system: req.system } : {}),
      ...(req.maxTokens ? { maxTokens: req.maxTokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...opts,
    });
    if (p.good !== index) {
      p.good = index;
      this.write();
    }
    return result;
  }

  private get(id: string): Stored {
    const p = this.list.find((x) => x.id === id);
    if (!p) throw new ProviderError('not_found');
    return p;
  }

  private endpoint(p: Stored): Endpoint {
    const keys: string[] = [];
    for (const k of p.keys) {
      try {
        keys.push(this.cipher.decrypt(k.sealed));
      } catch {
        // A key sealed on another computer or user account cannot be opened here.
      }
    }
    if (p.keys.length > 0 && keys.length === 0) throw new ProviderError('provider_no_key', 'sealed_elsewhere');
    if (keys.length === 0 && presetOf(p.preset)?.needsKey) throw new ProviderError('provider_no_key');
    return { baseUrl: p.baseUrl, wire: p.wire, keys, start: p.good ?? 0 };
  }

  private write(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ v: 1, providers: this.list } satisfies FileShape, null, 1), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

function publicInfo(p: Stored): ProviderInfo {
  return {
    id: p.id,
    preset: p.preset,
    name: p.name,
    baseUrl: p.baseUrl,
    wire: p.wire,
    keys: p.keys.map(({ id, hint, added }) => ({ id, hint, added })),
    models: p.models,
    ...(p.modelsAt ? { modelsAt: p.modelsAt } : {}),
  };
}
