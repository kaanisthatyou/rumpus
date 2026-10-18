// The contract between Lonca's core process and its clients (the renderer today; the phone and other
// members' apps later). Everything that crosses a process boundary is defined here.
import { z } from 'zod';
import type {
  Advisor,
  AdvisorInput,
  Agent,
  AgentInput,
  Card,
  CardStatus,
  Channel,
  Goal,
  GoalBudget,
  GoalComment,
  GoalInput,
  Job,
  Message,
  Quota,
  RecordInput,
  RecordItem,
  RecordKind,
  TranscriptEntry,
  WorkspaceState,
  WorkspaceSummary,
} from './workspace.js';

export * from './providers.js';
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
  /** Hours when advisors speak only when asked, `HH:MM` to `HH:MM`; equal times turn it off. */
  quietHours: z
    .object({ from: z.string().regex(/^\d\d:\d\d$/), to: z.string().regex(/^\d\d:\d\d$/) })
    .default({ from: '23:00', to: '08:00' }),
  /** The open workspace. */
  workspace: z.string().max(64).default('personal'),
  /** Rebound shortcuts: action → combo like `Ctrl+Shift+K`. Missing actions use the defaults. */
  shortcuts: z.record(z.string(), z.string().max(40)).default({}),
});
export type Settings = z.infer<typeof SettingsSchema>;
export type Language = Settings['language'];
export type Theme = Settings['theme'];
export type Accent = Settings['accent'];

export const SettingsPatchSchema = SettingsSchema.omit({ v: true })
  .extend({ profile: SettingsSchema.shape.profile.partial() })
  .partial();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

/** Actions with a shortcut, and their defaults (PLAN.md 5.10). */
export const SHORTCUTS = {
  palette: 'Ctrl+K',
  settings: 'Ctrl+,',
  shortcuts: 'Ctrl+/',
  prevChannel: 'Alt+ArrowUp',
  nextChannel: 'Alt+ArrowDown',
  stop: 'Ctrl+.',
  prevWaiting: 'Ctrl+Shift+ArrowUp',
  nextWaiting: 'Ctrl+Shift+ArrowDown',
} as const;
export type ShortcutAction = keyof typeof SHORTCUTS;

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
    quietHours: { from: '23:00', to: '08:00' },
    workspace: 'personal',
    shortcuts: {},
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
  'workspaces.list': { params: undefined; result: WorkspaceSummary[] };
  'workspaces.create': { params: { name: string }; result: WorkspaceSummary };
  /** Makes a workspace the open one; others keep running in the background. */
  'workspaces.open': { params: { id: string }; result: WorkspaceState };
  'channels.create': { params: { name: string }; result: Channel };
  'channels.rename': { params: { id: string; name: string }; result: Channel };
  'channels.delete': { params: { id: string }; result: { ok: true } };
  'messages.list': {
    params: { channelId: string; before?: number; limit?: number };
    result: { messages: Message[]; jobs: Job[] };
  };
  'messages.send': { params: { channelId: string; text: string; refs?: string[] }; result: Message };
  'messages.edit': { params: { id: string; text: string }; result: Message };
  'messages.delete': { params: { id: string }; result: { ok: true } };
  'messages.search': { params: { query: string; limit?: number }; result: Message[] };
  'agents.save': { params: AgentInput; result: Agent };
  'agents.delete': { params: { id: string }; result: { ok: true } };
  'agents.newSession': { params: { agentId: string; channelId: string }; result: { ok: true } };
  'advisors.save': { params: AdvisorInput; result: Advisor };
  'advisors.delete': { params: { id: string }; result: { ok: true } };
  'goals.list': { params: undefined; result: Goal[] };
  'goals.create': { params: GoalInput; result: Goal };
  /** Approve the plan, with comments that travel with every step. */
  'goals.approve': { params: { id: string; comments: GoalComment[] }; result: Goal };
  'goals.stop': { params: { id: string }; result: Goal };
  /** Removes a finished goal's worktree (its branch stays). */
  'goals.removeWorktree': { params: { id: string }; result: Goal };
  /** Continue a paused goal, optionally with more budget. */
  'goals.resume': { params: { id: string; more?: Partial<GoalBudget> }; result: Goal };
  /** `/meclis`: the advisors in the channel discuss a topic in turn and one sums up. */
  'advisors.council': { params: { channelId: string; topic: string }; result: Message };
  'jobs.stop': { params: { id: string }; result: { ok: true } };
  'jobs.steer': { params: { id: string; text: string }; result: { ok: true } };
  'jobs.answer': { params: { id: string; allow: boolean }; result: { ok: true } };
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
  'records.list': { params: { kind?: RecordKind }; result: RecordItem[] };
  'records.save': { params: RecordInput; result: RecordItem };
  'records.delete': { params: { id: string }; result: { ok: true } };
  'records.image': { params: { id: string }; result: string };
  'instructions.get': { params: undefined; result: InstructionLayers };
  'instructions.save': { params: { layer: 'worker' | 'workspace'; text: string }; result: InstructionLayers };
  'instructions.reset': { params: { layer: 'worker' }; result: InstructionLayers };
  'instructions.preview': { params: { agentId: string }; result: string };
}

export interface CoreEvents {
  'settings.changed': Settings;
  'clis.changed': CliInfo[];
  'workspace.changed': WorkspaceState;
  'workspaces.changed': WorkspaceSummary[];
  'message.added': Message;
  'message.updated': Message;
  'message.deleted': { id: string; channelId: string };
  'job.updated': Job;
  'quota.changed': { kind: CliKind; quota: Quota };
  'card.changed': Card;
  'card.deleted': { id: string };
  'record.changed': RecordItem;
  'record.deleted': { id: string };
  'goal.changed': Goal;
  /** An advisor is writing (or stopped writing) in a channel. */
  'advisor.typing': { advisorId: string; channelId: string; on: boolean };
  'advisor.spend': Record<string, number>;
  /** An advisor could not answer a mention: over budget, provider error. Not stored. */
  'advisor.failed': { advisorId: string; channelId: string; code: string };
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
  'invalid_advisor',
  'invalid_goal',
  'goal_state',
  'not_git',
  'worktree_failed',
  'no_advisors',
  'over_budget',
  'provider_bad_url',
  'provider_bad_key',
  'provider_storage',
  'provider_no_key',
  'provider_auth',
  'provider_rate_limited',
  'provider_unreachable',
  'provider_timeout',
  'provider_cancelled',
  'provider_bad_response',
  'provider_refused',
  'provider_no_tools',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** The instruction layers shown in Settings (PLAN.md 5.14). */
export interface InstructionLayers {
  core: string;
  worker: { text: string; isDefault: boolean; defaultChanged: boolean; default: string };
  workspace: string;
  variables: string[];
}

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
