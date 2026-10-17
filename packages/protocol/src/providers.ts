// Model providers for advisors, memory upkeep and voice (PLAN.md 6.7). Workers never use these: they run on the
// person's own CLI login. Keys stay in Electron's main process; everything here is safe to show.

/** How a provider is spoken to: OpenAI's chat completions (most of them) or Anthropic's messages API. */
export type ProviderWire = 'openai' | 'anthropic';

export interface ProviderPreset {
  id: string;
  /** Brand name; `custom` takes its name from the locale files. */
  name: string;
  baseUrl: string;
  wire: ProviderWire;
  /** A key is needed to use it (local servers work without one). */
  needsKey: boolean;
  /** Where the provider hands out keys. */
  keyUrl?: string;
}

export const PROVIDER_PRESETS = [
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    wire: 'openai',
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    wire: 'anthropic',
    needsKey: true,
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    wire: 'openai',
    needsKey: true,
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    wire: 'openai',
    needsKey: true,
    keyUrl: 'https://build.nvidia.com/settings/api-keys',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    wire: 'openai',
    needsKey: true,
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    wire: 'openai',
    needsKey: true,
    keyUrl: 'https://openrouter.ai/settings/keys',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    wire: 'openai',
    needsKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', wire: 'openai', needsKey: false },
  { id: 'lmstudio', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', wire: 'openai', needsKey: false },
  { id: 'llamacpp', name: 'llama.cpp', baseUrl: 'http://127.0.0.1:8080/v1', wire: 'openai', needsKey: false },
  { id: 'custom', name: '', baseUrl: '', wire: 'openai', needsKey: false },
] as const satisfies readonly ProviderPreset[];

export type ProviderPresetId = (typeof PROVIDER_PRESETS)[number]['id'];

export function presetOf(id: string): ProviderPreset | undefined {
  return (PROVIDER_PRESETS as readonly ProviderPreset[]).find((p) => p.id === id);
}

export interface ProviderKeyInfo {
  id: string;
  /** The last four characters, to tell keys apart. */
  hint: string;
  added: number;
}

export interface ProviderInfo {
  id: string;
  preset: string;
  name: string;
  baseUrl: string;
  wire: ProviderWire;
  keys: ProviderKeyInfo[];
  /** Model ids from the provider's `/models`, as last fetched. */
  models: string[];
  modelsAt?: number;
}

export interface ProviderInput {
  /** Missing: a new provider. */
  id?: string;
  preset: string;
  name: string;
  baseUrl: string;
  wire?: ProviderWire;
  /** A key to add at the end of the chain. */
  addKey?: string;
}

/** How well the keys are protected at rest: the OS keychain, a fixed password (Linux without one), or not at all. */
export type KeyProtection = 'os' | 'weak' | 'none';

export interface ProvidersState {
  providers: ProviderInfo[];
  protection: KeyProtection;
}

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  providerId: string;
  model: string;
  system?: string;
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface LlmResult {
  text: string;
  usage: { in: number; out: number; estimated?: boolean };
}

/**
 * Plain http only for this computer, the local network and the tailnet; everything else must be https, so keys
 * do not cross the internet in the clear.
 */
export function providerUrlAllowed(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 100 && b >= 64 && b <= 127) // Tailscale's addresses
  );
}
