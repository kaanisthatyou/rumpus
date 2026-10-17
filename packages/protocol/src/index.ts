// The contract between Lonca's core process and its clients (the renderer today; the phone and other
// members' apps later). Everything that crosses a process boundary is defined here.
import { z } from 'zod';
import type {
  Agent,
  AgentInput,
  Card,
  CardStatus,
  Channel,
  Job,
  Message,
  Quota,
  TranscriptEntry,
  WorkspaceState,
} from './workspace.js';

export * from './workspace.js';

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

import type { CliKind } from './kinds.js';

export { CLI_KINDS, type CliKind } from './kinds.js';

/**
 * - `ready`: installed and signed in (or an API key is set).
 * - `signed-out`: installed, its own login reports no account.
 * - `needs-key`: installed, but Lonca only runs it with an API key (Google's terms) and none is set.
 * - `unknown`: installed, the login state cannot be read without spending tokens.
 * - `missing`: not found on this computer.
 */
export type CliState = 'ready' | 'signed-out' | 'needs-key' | 'unknown' | 'missing';

export interface CliInfo {
  kind: CliKind;
  state: CliState;
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
  'clis.list': { params: { refresh?: boolean }; result: CliInfo[] };
  'clis.login': { params: { kind: CliKind }; result: { opened: boolean } };
  'tailscale.status': { params: undefined; result: TailscaleInfo };
  'system.info': {
    params: undefined;
    result: { platform: Platform; dataDir: string; defaultDataDir: string };
  };
  'workspace.get': { params: undefined; result: WorkspaceState };
  'channels.create': { params: { name: string }; result: Channel };
  'channels.rename': { params: { id: string; name: string }; result: Channel };
  'channels.delete': { params: { id: string }; result: { ok: true } };
  'messages.list': {
    params: { channelId: string; before?: number; limit?: number };
    result: { messages: Message[]; jobs: Job[] };
  };
  'messages.send': { params: { channelId: string; text: string }; result: Message };
  'messages.edit': { params: { id: string; text: string }; result: Message };
  'messages.delete': { params: { id: string }; result: { ok: true } };
  'messages.search': { params: { query: string; limit?: number }; result: Message[] };
  'agents.save': { params: AgentInput; result: Agent };
  'agents.delete': { params: { id: string }; result: { ok: true } };
  'agents.newSession': { params: { agentId: string; channelId: string }; result: { ok: true } };
  'jobs.stop': { params: { id: string }; result: { ok: true } };
  'jobs.steer': { params: { id: string; text: string }; result: { ok: true } };
  'jobs.transcript': { params: { id: string }; result: TranscriptEntry[] };
  'quota.get': { params: undefined; result: Partial<Record<CliKind, Quota>> };
  'cards.list': { params: undefined; result: Card[] };
  'cards.create': { params: { title: string; channelId?: string; agentHandle?: string }; result: Card };
  'cards.update': {
    params: { id: string; title?: string; status?: CardStatus; assigneeAgentId?: string | null };
    result: Card;
  };
  'cards.delete': { params: { id: string }; result: { ok: true } };
  'cards.run': { params: { id: string }; result: Card };
}

export interface CoreEvents {
  'settings.changed': Settings;
  'clis.changed': CliInfo[];
  'workspace.changed': WorkspaceState;
  'message.added': Message;
  'message.updated': Message;
  'message.deleted': { id: string; channelId: string };
  'job.updated': Job;
  'quota.changed': { kind: CliKind; quota: Quota };
  'card.changed': Card;
  'card.deleted': { id: string };
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
  'not_found',
  'invalid_agent',
  'handle_taken',
  'folder_missing',
  'cli_missing',
  'busy',
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
