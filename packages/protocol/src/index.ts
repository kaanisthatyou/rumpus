// The contract between Lonca's core process and its clients (the renderer today; the phone and other
// members' apps later). Everything that crosses a process boundary is defined here.
import { z } from 'zod';

// ---------------------------------------------------------------- settings

export const LANGUAGES = ['tr', 'en'] as const;
export const THEMES = ['dark', 'light', 'system'] as const;
export const ACCENTS = ['lime', 'blue', 'orange', 'violet'] as const;
export const MOTION = ['system', 'reduced'] as const;

export const SettingsSchema = z.object({
  v: z.literal(1),
  language: z.enum(LANGUAGES),
  theme: z.enum(THEMES),
  accent: z.enum(ACCENTS),
  motion: z.enum(MOTION),
  profile: z.object({
    name: z.string().trim().max(40),
  }),
  /** Where workspaces, records and history live. Empty means the default inside the app's data folder. */
  dataDir: z.string(),
  onboarded: z.boolean(),
});
export type Settings = z.infer<typeof SettingsSchema>;
export type Language = Settings['language'];
export type Theme = Settings['theme'];
export type Accent = Settings['accent'];

export const SettingsPatchSchema = SettingsSchema.omit({ v: true })
  .extend({ profile: SettingsSchema.shape.profile.partial() })
  .partial();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export function defaultSettings(language: Language = 'en'): Settings {
  return {
    v: 1,
    language,
    theme: 'dark',
    accent: 'lime',
    motion: 'system',
    profile: { name: '' },
    dataDir: '',
    onboarded: false,
  };
}

// ---------------------------------------------------------------- agents (CLI) and network

export const AGENT_KINDS = ['claude-code', 'codex', 'opencode', 'gemini', 'antigravity'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

/**
 * - `ready`: installed and signed in (or an API key is set).
 * - `signed-out`: installed, its own login reports no account.
 * - `needs-key`: installed, but Lonca only runs it with an API key (Google's terms) and none is set.
 * - `unknown`: installed, the login state cannot be read without spending tokens.
 * - `missing`: not found on this computer.
 */
export type AgentState = 'ready' | 'signed-out' | 'needs-key' | 'unknown' | 'missing';

export interface AgentInfo {
  kind: AgentKind;
  state: AgentState;
  /** Absolute path of the executable, when found. */
  path?: string;
  version?: string;
  /** How the CLI is signed in, as the CLI reports it: `subscription`, `api-key`, ... */
  auth?: string;
  /** Plan name the CLI reports, e.g. `pro`. Never an email or account id. */
  plan?: string;
  /** Lonca can open the CLI's own login in a console. */
  canLogin: boolean;
  install: { windows: string; linux: string; docs: string };
}

export interface TailscaleInfo {
  state: 'missing' | 'stopped' | 'needs-login' | 'running' | 'unknown';
  ip?: string;
  host?: string;
}

// ---------------------------------------------------------------- RPC

/** `process.platform` values, without depending on Node's types in the browser. */
export type Platform = 'win32' | 'linux' | 'darwin' | (string & {});

export interface CoreMethods {
  'settings.get': { params: undefined; result: Settings };
  'settings.update': { params: SettingsPatch; result: Settings };
  'agents.list': { params: { refresh?: boolean }; result: AgentInfo[] };
  'agents.login': { params: { kind: AgentKind }; result: { opened: boolean } };
  'tailscale.status': { params: undefined; result: TailscaleInfo };
  'system.info': {
    params: undefined;
    result: { platform: Platform; dataDir: string; defaultDataDir: string };
  };
}

export interface CoreEvents {
  'settings.changed': Settings;
  'agents.changed': AgentInfo[];
}

export type MethodName = keyof CoreMethods;
export type Params<M extends MethodName> = CoreMethods[M]['params'];
export type Result<M extends MethodName> = CoreMethods[M]['result'];
export type EventName = keyof CoreEvents;

/** Every refusal is a code; the UI translates it (`errors.<code>` in the locale files). */
export const ERROR_CODES = [
  'bad_request',
  'unknown_method',
  'invalid_settings',
  'not_installed',
  'login_unavailable',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class CoreError extends Error {
  constructor(
    readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'CoreError';
  }
}

export type Request = { id: number; method: string; params?: unknown };
export type Response = { id: number; result: unknown } | { id: number; error: { code: ErrorCode; message: string } };
export type Notice = { event: string; data: unknown };
export type Frame = Request | Response | Notice;

export function isResponse(frame: unknown): frame is Response {
  return typeof frame === 'object' && frame !== null && 'id' in frame && ('result' in frame || 'error' in frame);
}

export function isNotice(frame: unknown): frame is Notice {
  return typeof frame === 'object' && frame !== null && 'event' in frame;
}

export function isRequest(frame: unknown): frame is Request {
  return (
    typeof frame === 'object' &&
    frame !== null &&
    'id' in frame &&
    'method' in frame &&
    typeof (frame as Request).method === 'string'
  );
}
