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
  GitState,
  Goal,
  GoalBudget,
  GoalComment,
  GoalInput,
  Job,
  MemberRole,
  MemorySection,
  MemoryState,
  Message,
  ProjectInput,
  ProjectStatusInput,
  ProjectView,
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

/** The settings fields as they are checked; the stored file fills in the newer ones from defaults (below). */
const SETTINGS_FIELDS = {
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
  quietHours: z.object({ from: z.string().regex(/^\d\d:\d\d$/), to: z.string().regex(/^\d\d:\d\d$/) }),
  /** The open workspace. */
  workspace: z.string().max(64),
  /** Serve the UI to this person's paired phones over Tailscale. */
  phone: z.boolean(),
  /** Rebound shortcuts: action → combo like `Ctrl+Shift+K`. Missing actions use the defaults. */
  shortcuts: z.record(z.string(), z.string().max(40)),
};

export const SettingsSchema = z.object({
  ...SETTINGS_FIELDS,
  quietHours: SETTINGS_FIELDS.quietHours.default({ from: '23:00', to: '08:00' }),
  workspace: SETTINGS_FIELDS.workspace.default('personal'),
  phone: SETTINGS_FIELDS.phone.default(false),
  shortcuts: SETTINGS_FIELDS.shortcuts.default({}),
});
export type Settings = z.infer<typeof SettingsSchema>;
export type Language = Settings['language'];
export type Theme = Settings['theme'];
export type Accent = Settings['accent'];

/**
 * A change to some settings. Built from the fields without their defaults: with them, a patch of one field would
 * carry every defaulted field too and reset it (shortcuts, quiet hours, the open workspace, the phone).
 */
export const SettingsPatchSchema = z
  .object(SETTINGS_FIELDS)
  .omit({ v: true })
  .extend({ profile: SETTINGS_FIELDS.profile.partial() })
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
    phone: false,
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

/** An extra login of a CLI on this computer: its own config folder, signed in with the CLI's own login. */
export interface CliAccount {
  id: string;
  kind: CliKind;
  name: string;
  folder: string;
  state: CliState;
  auth?: string;
  plan?: string;
}

/** `/durum`: one computer's CLIs, extra logins and quota, as that computer reports them (PLAN.md 5.5). */
export interface DeviceStatus {
  device: string;
  name: string;
  me: boolean;
  /** Installed CLIs only. */
  clis: { kind: CliKind; state: CliState; version?: string; plan?: string }[];
  accounts: { name: string; kind: CliKind; state: CliState; plan?: string }[];
  quotas: { kind: CliKind; account?: string; quota: Quota }[];
  at: number;
}

export interface PhoneState {
  on: boolean;
  /** The address phones open (https behind `tailscale serve`), once it works. */
  url?: string;
  /** Why it does not work yet: `tailscale` (not running), `https` (the tailnet gives no certificates), `serve`. */
  problem?: 'tailscale' | 'https' | 'serve' | 'port';
  phones: { id: string; name: string; created: number; lastSeen?: number; push: boolean }[];
}

export interface TailscaleInfo {
  state: 'missing' | 'stopped' | 'needs-login' | 'running' | 'unknown';
  ip?: string;
  host?: string;
  /** The device's name in the tailnet (`pc.tailnet.ts.net`). */
  dns?: string;
  /** The tailnet hands out HTTPS certificates (needed for `tailscale serve` and an installable phone app). */
  https?: boolean;
}

// ---------------------------------------------------------------- RPC

/** `process.platform` values, without depending on Node's types in the browser. */
export type Platform = 'win32' | 'linux' | 'darwin' | (string & {});

export interface CoreMethods {
  'settings.get': { params: undefined; result: Settings };
  'settings.update': { params: SettingsPatch; result: Settings };
  'clis.list': { params: { refresh?: boolean }; result: CliInfo[] };
  'clis.login': { params: { kind: CliKind; account?: string }; result: { opened: boolean } };
  /** This computer's extra CLI logins with their state (read with each CLI's status command, no tokens). */
  'accounts.list': { params: { refresh?: boolean }; result: CliAccount[] };
  /** `/durum`: this computer, then the members of the open team workspace that answered lately (more arrive as events). */
  'status.get': { params: undefined; result: DeviceStatus[] };
  'accounts.add': { params: { kind: CliKind; name: string }; result: CliAccount[] };
  /** Forgets an account; its folder stays (the CLI's own files). */
  'accounts.remove': { params: { id: string }; result: CliAccount[] };
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
  'memory.get': { params: undefined; result: MemoryState };
  'memory.save': { params: { section: MemorySection; text: string }; result: MemoryState };
  /** `/hatırla`: a line for the personal notes. */
  'memory.remember': { params: { text: string }; result: MemoryState };
  'memory.accept': { params: { id: string; text?: string }; result: MemoryState };
  'memory.reject': { params: { id: string }; result: MemoryState };
  'phones.state': { params: undefined; result: PhoneState };
  /** A one-time pairing link for a QR, valid for ten minutes. */
  'phones.pair': { params: undefined; result: { url: string; expires: number } };
  'phones.revoke': { params: { id: string }; result: PhoneState };
  /** An invite code for the open team workspace (admins). */
  'invites.create': { params: { role: MemberRole; hours?: number }; result: { code: string; expires: number } };
  /** Asks to join a team workspace with a code; an admin of it approves. */
  'invites.join': { params: { code: string }; result: WorkspaceSummary };
  'invites.answer': { params: { id: string; approve: boolean }; result: { ok: true } };
  'members.setRole': { params: { device: string; role: MemberRole }; result: { ok: true } };
  'members.remove': { params: { device: string }; result: { ok: true } };
  'channels.create': { params: { name: string }; result: Channel };
  'channels.rename': { params: { id: string; name: string }; result: Channel };
  'channels.delete': { params: { id: string }; result: { ok: true } };
  /** A person is typing in a channel (team workspaces tell the others; nothing is stored). */
  'channels.typing': { params: { channelId: string }; result: { ok: true } };
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
  /** An advisor's own notes, kept on the computer it runs on (its owner reads and edits them). */
  'advisors.notes': { params: { id: string }; result: string };
  'advisors.saveNotes': { params: { id: string; text: string }; result: string };
  /** `/özet [hours]`: an advisor of the channel (the one named, else the first) sums up its last hours. */
  'advisors.digest': { params: { channelId: string; hours?: number; handle?: string }; result: Message };
  'jobs.stop': { params: { id: string }; result: { ok: true } };
  'jobs.steer': { params: { id: string; text: string }; result: { ok: true } };
  'jobs.answer': { params: { id: string; allow: boolean }; result: { ok: true } };
  'jobs.transcript': { params: { id: string }; result: TranscriptEntry[] };
  /** Quota per CLI (`claude-code`) and per extra account (`claude-code:<account id>`). */
  'quota.get': { params: undefined; result: Record<string, Quota> };
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
  'projects.list': { params: undefined; result: ProjectView[] };
  /** Makes or changes a project; `folder` is this computer's clone and stays on this computer. */
  'projects.save': { params: ProjectInput; result: ProjectView };
  'projects.delete': { params: { id: string }; result: { ok: true } };
  'projects.status': { params: ProjectStatusInput; result: ProjectView };
  /** The clone's git state; `fetch` asks the remote first (at most every five minutes unless `force`). */
  'projects.git': { params: { id: string; fetch?: boolean; force?: boolean }; result: GitState };
  'projects.pull': { params: { id: string }; result: { ok: boolean; output: string; git: GitState } };
  'projects.push': { params: { id: string }; result: { ok: boolean; output: string; git: GitState } };
  /** The status page as Markdown in Fabrika's `progress.md` shape. */
  'projects.export': { params: { id: string }; result: string };
}

export interface CoreEvents {
  'settings.changed': Settings;
  'clis.changed': CliInfo[];
  'workspace.changed': WorkspaceState;
  'workspaces.changed': WorkspaceSummary[];
  'phones.changed': PhoneState;
  'memory.changed': MemoryState;
  'message.added': Message;
  'message.updated': Message;
  'message.deleted': { id: string; channelId: string };
  'job.updated': Job;
  /** `kind` is the CLI, or `<cli>:<account id>` for an extra account. */
  'quota.changed': { kind: string; quota: Quota };
  /** Another member's computer answered `/durum`. */
  'status.changed': DeviceStatus;
  'card.changed': Card;
  'card.deleted': { id: string };
  'record.changed': RecordItem;
  'record.deleted': { id: string };
  'goal.changed': Goal;
  'project.changed': ProjectView;
  'project.deleted': { id: string };
  /** Another member is typing in a channel of the open workspace. */
  'person.typing': { channelId: string; device: string; name: string };
  /** Something new from another member in a workspace that is not open. */
  'workspace.activity': { id: string };
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
  'not_allowed',
  'no_identity',
  'no_address',
  'bad_code',
  'already_member',
  'invite_refused',
  'unreachable',
  'worktree_failed',
  'no_advisors',
  'invalid_project',
  'no_folder',
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
