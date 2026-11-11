// The contract between Serai's core process and its clients (the renderer today; the phone and other
// members' apps later). Everything that crosses a process boundary is defined here.
import { z } from 'zod';
import type { ConnectorInput, ConnectorsState, ToolPolicy } from './connectors.js';
import type { RegistryServer } from './registry.js';
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
  Overview,
  ProjectInput,
  ProjectStatusInput,
  ProjectView,
  Quota,
  RecordInput,
  RecordItem,
  RecordKind,
  Routine,
  RoutineInput,
  TranscriptEntry,
  WorkspaceState,
  WorkspaceSummary,
} from './workspace.js';

export * from './brand.js';
export * from './catalog.js';
export * from './connectors.js';
export * from './providers.js';
export * from './registry.js';
export * from './specialists.js';
export * from './traits.js';
export * from './workspace.js';

// ---------------------------------------------------------------- settings

export const LANGUAGES = ['tr', 'en'] as const;
export const THEMES = ['dark', 'light', 'system'] as const;
export const ACCENTS = ['lime', 'blue', 'orange', 'violet', 'teal', 'rose', 'amber'] as const;
export const MOTION = ['system', 'reduced'] as const;
/** The whole UI drawn smaller or larger (the window's zoom). */
export const TEXT_SIZES = ['small', 'normal', 'large'] as const;
/** How much room rows, messages and cards take. */
export const DENSITIES = ['comfortable', 'compact'] as const;
export const CLOCKS = ['24', '12'] as const;
/** What a start shows first: the overview, or the channel that was open last. */
export const START_VIEWS = ['home', 'last'] as const;
/**
 * The panel of agents and members: the whole panel, or a strip of avatars. A narrow window shows the strip either
 * way, and the panel opens over the page from it.
 */
export const CREW_LAYOUTS = ['panel', 'strip'] as const;

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
  textSize: z.enum(TEXT_SIZES),
  density: z.enum(DENSITIES),
  clock: z.enum(CLOCKS),
  startView: z.enum(START_VIEWS),
  crew: z.enum(CREW_LAYOUTS),
  /** The channel list is on screen (off: the middle column gets its room). */
  sidebar: z.boolean(),
  /** OS notifications while the app is in the background. */
  notifications: z.boolean(),
  /** The folder a new agent works in when none is picked. Empty means the desktop. */
  agentFolder: z.string().max(1024),
};

export const SettingsSchema = z.object({
  ...SETTINGS_FIELDS,
  quietHours: SETTINGS_FIELDS.quietHours.default({ from: '23:00', to: '08:00' }),
  workspace: SETTINGS_FIELDS.workspace.default('personal'),
  phone: SETTINGS_FIELDS.phone.default(false),
  shortcuts: SETTINGS_FIELDS.shortcuts.default({}),
  textSize: SETTINGS_FIELDS.textSize.default('normal'),
  density: SETTINGS_FIELDS.density.default('comfortable'),
  clock: SETTINGS_FIELDS.clock.default('24'),
  startView: SETTINGS_FIELDS.startView.default('last'),
  crew: SETTINGS_FIELDS.crew.default('panel'),
  sidebar: SETTINGS_FIELDS.sidebar.default(true),
  notifications: SETTINGS_FIELDS.notifications.default(true),
  agentFolder: SETTINGS_FIELDS.agentFolder.default(''),
});
export type Settings = z.infer<typeof SettingsSchema>;
export type Language = Settings['language'];
export type Theme = Settings['theme'];
export type Accent = Settings['accent'];
export type TextSize = Settings['textSize'];
export type Density = Settings['density'];
export type CrewLayout = Settings['crew'];

/**
 * A change to some settings. Built from the fields without their defaults: with them, a patch of one field would
 * carry every defaulted field too and reset it (shortcuts, quiet hours, the open workspace, the phone, the look).
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
  sidebar: 'Ctrl+B',
  crew: 'Ctrl+Shift+B',
  /** Global: works while another app is in front (never Ctrl Space, which editors use). */
  quickEntry: 'Ctrl+Alt+Space',
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
    textSize: 'normal',
    density: 'comfortable',
    clock: '24',
    startView: 'last',
    crew: 'panel',
    sidebar: true,
    notifications: true,
    agentFolder: '',
  };
}

// ---------------------------------------------------------------- agents (CLI) and network

import type { CliKind } from './kinds.js';

export { CLI_KINDS, type CliKind } from './kinds.js';

/**
 * - `ready`: installed and signed in (or an API key is set).
 * - `signed-out`: installed, its own login reports no account.
 * - `needs-key`: installed, but Serai only runs it with an API key (Google's terms) and none is set.
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
  /** Serai can open the CLI's own login in a console. */
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
  /** The tailnet's name, as Tailscale shows it. */
  tailnet?: string;
  /** The other devices this one can see: its own tailnet's and ones shared with it. */
  peers?: { name: string; ip: string; online: boolean }[];
}

/**
 * What an invite says before anything is sent (PLAN.md 5.11): which workspace, and whether the inviter's computer
 * can be reached from here, so a join that cannot work is explained instead of failing.
 */
export interface InviteCheck {
  /** The workspace's name, as the invite carries it. */
  name: string;
  /** The inviter's address (`100.x.y.z:47640`). */
  address: string;
  tailscale: TailscaleInfo['state'];
  /** The inviter's device among the ones Tailscale shows here; none when it is not in sight. */
  peer?: { name: string; online: boolean };
  /** A connection to the inviter's app opened. */
  reachable: boolean;
  /** This computer already has the workspace (or a request waiting). */
  joined: boolean;
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
    result: {
      platform: Platform;
      dataDir: string;
      defaultDataDir: string;
      /** The folder a new agent gets when none is picked: the one in settings, else the desktop. */
      agentFolder: string;
    };
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
  'invites.create': {
    params: { role: MemberRole; hours?: number };
    result: { code: string; link: string; expires: number };
  };
  /** Asks to join a team workspace with a code; an admin of it approves. */
  'invites.join': { params: { code: string }; result: WorkspaceSummary };
  /** Reads an invite without using it and tries the way to the inviter. */
  'invites.check': { params: { code: string }; result: InviteCheck };
  'invites.answer': { params: { id: string; approve: boolean }; result: { ok: true } };
  'members.setRole': { params: { device: string; role: MemberRole }; result: { ok: true } };
  'members.remove': { params: { device: string }; result: { ok: true } };
  'channels.create': { params: { name: string }; result: Channel };
  'channels.rename': { params: { id: string; name: string }; result: Channel };
  'channels.delete': { params: { id: string }; result: { ok: true } };
  /** A person is typing in a channel (team workspaces tell the others; nothing is stored). */
  'channels.typing': { params: { channelId: string }; result: { ok: true } };
  /** The person has the channel open: what is in it now counts as read. */
  'channels.read': { params: { channelId: string }; result: { ok: true } };
  'overview.get': { params: undefined; result: Overview };
  'routines.save': { params: RoutineInput; result: Routine };
  'routines.delete': { params: { id: string }; result: { ok: true } };
  /** Posts a routine's message now, whatever its time (its owner only). */
  'routines.run': { params: { id: string }; result: { ok: true } };
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
  /** A specialist's waiting lesson: kept (with the owner's edit) or dropped. */
  'lessons.accept': { params: { id: string; text?: string }; result: { ok: true } };
  'lessons.reject': { params: { id: string }; result: { ok: true } };
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
  /**
   * Takes over a Fabrika repository (roblox-factory): its ideas, references, saved prompts and games with a status
   * page become records and projects. Things already here (same kind and title, same project name) are skipped.
   */
  'fabrika.import': {
    params: { folder: string };
    result: { ideas: number; references: number; commands: number; projects: number; skipped: number };
  };
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
  /** This computer's connectors (never synced); secrets come back only as their last characters. */
  'connectors.list': { params: undefined; result: ConnectorsState };
  /**
   * Adds or changes a connector. A new or changed server is tested in the background (`initialize` and
   * `tools/list`, a first `npx` download can take a while): it shows as `testing`, then `connectors.changed`.
   */
  'connectors.save': { params: ConnectorInput; result: ConnectorsState };
  'connectors.test': { params: { id: string }; result: ConnectorsState };
  'connectors.remove': { params: { id: string }; result: ConnectorsState };
  'connectors.policy': { params: { id: string; tool: string; policy: ToolPolicy }; result: ConnectorsState };
  /** The official MCP Registry, searched by name (community entries, not reviewed by Serai). */
  'connectors.search': {
    params: { query: string; cursor?: string };
    result: { servers: RegistryServer[]; next?: string };
  };
  /** Which programs that run connector packages this computer has. */
  'connectors.runtimes': { params: undefined; result: { npx: boolean; uvx: boolean; docker: boolean } };
}

export interface CoreEvents {
  'settings.changed': Settings;
  'clis.changed': CliInfo[];
  'workspace.changed': WorkspaceState;
  'workspaces.changed': WorkspaceSummary[];
  'connectors.changed': ConnectorsState;
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
  'not_fabrika',
  'invalid_connector',
  'connector_storage',
  'connector_failed',
  'registry_unreachable',
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
