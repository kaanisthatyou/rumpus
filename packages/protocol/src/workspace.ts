// Workspace data: channels, agents, messages, jobs. Shared by the core and every client.
import { z } from 'zod';
import { CLI_KINDS } from './kinds.js';

/** The autonomy ladder, the same three words for every CLI: read, edit, full. */
export const AGENT_MODES = ['read', 'edit', 'full'] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

/** Most of a channel's latest messages a specialist reads before a job. */
export const SPECIALIST_HISTORY_MAX = 200;
/** Characters of lessons a specialist keeps; the oldest lines go first. */
export const LESSONS_LIMIT = 6000;

/**
 * What makes an agent a specialist (Fabrika's Blender agent made general): one kind of work, done the same way
 * every time. It follows a playbook, reads the channel before it starts, gets the same reference records with
 * every job, works within a budget, starts every job in a fresh session, keeps lessons for the next one, and can
 * end with a RESULT line for whoever asked. It never hands work on.
 */
export const SpecialtySchema = z.object({
  /** One line: what it is for. Shown next to its name and told to the other agents. */
  role: z.string().trim().min(1).max(140),
  /** How it works, step by step: Markdown, written by its owner. */
  playbook: z.string().max(20_000).default(''),
  /** How many of the channel's latest messages it reads before a job; 0 means only the request. */
  history: z.number().int().min(0).max(SPECIALIST_HISTORY_MAX).default(30),
  /** Reference records (images with notes) it gets with every job. */
  refs: z.array(z.string().max(64)).max(12).default([]),
  /** Per job: minutes, and optionally tokens (new input and output). Past it the job is stopped. */
  budget: z
    .object({
      minutes: z.number().int().min(1).max(240),
      tokens: z.number().int().min(1000).max(50_000_000).optional(),
    })
    .optional(),
  /** Ends its answer with a `RESULT {json}` line that is taken out of the chat and handed to whoever asked. */
  result: z.boolean().default(false),
  /** Keeps lessons from its jobs (the `learn_lesson` tool). */
  learns: z.boolean().default(true),
  /** What it kept so far: one lesson per line, dated; its owner edits them. */
  lessons: z.string().max(LESSONS_LIMIT).default(''),
  /** The template it was made from. */
  template: z.string().max(40).optional(),
});
export type Specialty = z.infer<typeof SpecialtySchema>;

/**
 * A lesson a specialist wants to keep that waits for its owner: it came from a job someone else asked for, or
 * something in it looks like steering. Kept on the owner's computer only.
 */
export interface LessonSuggestion {
  id: string;
  agentId: string;
  text: string;
  /** Who asked for the job it came from. */
  from: string;
  jobId?: string;
  at: number;
  flags?: string[];
}

export const AgentInputSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(CLI_KINDS),
  name: z.string().trim().min(1).max(40),
  /** What people type after `@`: lowercase letters, digits and dashes. */
  handle: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
  folder: z.string().min(1),
  mode: z.enum(AGENT_MODES),
  model: z.string().trim().max(80).optional(),
  /** The agent's own instruction layer (PLAN.md 5.14, layer 4). */
  instructions: z.string().max(20_000).default(''),
  /** One of this computer's extra logins of the CLI (Settings → Agents → Accounts); none means the default one. */
  account: z.string().max(64).optional(),
  /** In a team workspace: who besides the owner may give it jobs, and how far (PLAN.md 5.11). */
  access: z
    .object({
      who: z.enum(['me', 'members']),
      maxMode: z.enum(AGENT_MODES),
      approveOthers: z.boolean(),
    })
    .optional(),
  /** Present on a specialist. */
  specialty: SpecialtySchema.optional(),
});

export type AgentAccess = NonNullable<z.infer<typeof AgentInputSchema>['access']>;
/** Only the owner, and read-only for anyone else the owner lets in. */
export const DEFAULT_ACCESS: AgentAccess = { who: 'me', maxMode: 'read', approveOthers: false };
export type AgentInput = z.input<typeof AgentInputSchema>;

export interface Agent {
  id: string;
  kind: (typeof CLI_KINDS)[number];
  name: string;
  handle: string;
  folder: string;
  mode: AgentMode;
  model?: string;
  instructions: string;
  /** The device that added it: jobs run there, on that member's CLI login. Missing on agents from before teams. */
  owner?: string;
  /** The owner's extra login of the CLI it runs on, when not the default one. */
  account?: string;
  access?: AgentAccess;
  specialty?: Specialty;
  created: number;
}

/** Advisors' personalities (PLAN.md 5.4); `custom` starts from an empty prompt. */
export const PERSONALITIES = ['critical', 'blunt', 'positive', 'custom'] as const;
export type Personality = (typeof PERSONALITIES)[number];

/** How often an advisor speaks unasked: never, now and then, often. Mentions are always answered. */
export const CHATTER = ['off', 'low', 'normal', 'high'] as const;
export type Chatter = (typeof CHATTER)[number];

/** The personality presets' prompts. Shipped defaults, copied into the advisor and editable there. */
export const PERSONALITY_PROMPTS: Record<Personality, string> = {
  critical:
    'You are the critical one. Look for what is wrong, risky or missing: bugs, weak assumptions, unclear goals, scope creep, work that will not survive contact with real users. Name the problem, why it matters, and the smallest fix. Praise only what is truly notable.',
  blunt:
    'You say plainly what others avoid saying. Short and direct, no softening and no flattery. When an idea is bad, say so and why; when you are unsure, say that too. Never rude, never vague.',
  positive:
    'You look for what works and how to build on it, without empty praise. Point out real strengths, then one concrete next step that makes the best part better. Stay honest: do not hide real problems, mention them briefly.',
  custom: '',
};

export const AdvisorInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(40),
  handle: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
  personality: z.enum(PERSONALITIES),
  /** The personality prompt, editable; starts as the preset's. */
  prompt: z.string().max(8000),
  providerId: z.string().min(1),
  model: z.string().trim().min(1).max(160),
  /** Channels it speaks in unasked; empty means every normal channel. */
  channels: z.array(z.string()).max(50).default([]),
  chatter: z.enum(CHATTER),
  /** Tokens (in and out) it may spend per day. */
  dailyTokens: z.number().int().min(1000).max(50_000_000),
  /** A project folder it looks at (git history, status); read only. */
  folder: z.string().max(1000).optional(),
});
export type AdvisorInput = z.input<typeof AdvisorInputSchema>;

export interface Advisor {
  id: string;
  name: string;
  handle: string;
  personality: Personality;
  prompt: string;
  providerId: string;
  model: string;
  channels: string[];
  chatter: Chatter;
  dailyTokens: number;
  folder?: string;
  /** The device that added it: it runs there, with that member's keys. */
  owner: string;
  created: number;
}

export interface Channel {
  id: string;
  name: string;
  /** `agent`: the direct channel of one agent, where every message goes to it. */
  kind: 'channel' | 'agent';
  agentId?: string;
  topic: string;
  created: number;
}

export type Author =
  | { kind: 'person'; id: string; name: string }
  | { kind: 'agent'; id: string; name: string }
  | { kind: 'advisor'; id: string; name: string }
  | { kind: 'system' };

export interface Message {
  id: string;
  channelId: string;
  author: Author;
  text: string;
  created: number;
  edited?: number;
  /** For an agent's answer: the job it ends. */
  jobId?: string;
  /** References attached to the message; a job started by it gets their images. */
  refs?: string[];
  /**
   * A part of a person's job that the agent doing it handed to another agent (Fabrika's job_request.py): the
   * person's message it continues and the agent that handed it over. A handed part never hands over again.
   */
  handover?: { requestId: string; agentId: string };
  /** A specialist's `RESULT {json}` line, taken out of the text: what whoever asked needs from the job. */
  result?: Record<string, unknown>;
  /** Posted for its author by one of their routines (its id). */
  routine?: string;
}

/** idle is never stored: a job is running, waiting on a person, or over. */
export type JobState = 'running' | 'attention' | 'done' | 'failed' | 'stopped';

export interface JobStep {
  id: string;
  kind: 'tool' | 'steer' | 'denied' | 'notice';
  /** A short verb from the tool's name, translated by the UI when it knows it (`job.tool.<label>`). */
  label: string;
  arg?: string;
  ok?: boolean;
  preview?: string;
  at: number;
}

export interface Usage {
  in: number;
  cached: number;
  out: number;
}

export interface Job {
  id: string;
  channelId: string;
  agentId: string;
  /** The person's message that started it. */
  requestId: string;
  state: JobState;
  steps: JobStep[];
  usage: Usage;
  /** The answer so far, while it streams. */
  preview?: string;
  cost?: number;
  /** An error code (`auth_failed`, `cli_missing`, `exited`, ...) or the CLI's own text. */
  error?: string;
  /** How many memory sections went into the agent's prompt for this job. */
  recalled?: number;
  /** A specialist's budget for this job; `warned` once the agent was told it is nearly used. */
  budget?: { minutes: number; tokens?: number; warned?: boolean };
  /** While the job waits on a person: the tool call that needs approval. */
  approval?: { id: string; label: string; arg?: string; detail?: string };
  started: number;
  ended?: number;
}

export interface QuotaWindow {
  /** 0..1 */
  used: number;
  /** Unix seconds. */
  resets?: number;
}

export interface Quota {
  windows: Record<string, QuotaWindow>;
  status?: string;
  at: number;
}

/** A workspace in the rail: the personal one (never synced) or a team one. */
export interface WorkspaceSummary {
  id: string;
  name: string;
  kind: 'personal' | 'team';
  created: number;
  /** A team workspace this device asked to join: waiting for an admin, or turned down. */
  state?: 'joining' | 'denied';
}

export const MEMBER_ROLES = ['viewer', 'editor', 'admin'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export interface MemberInfo {
  device: string;
  name: string;
  role: MemberRole;
  me: boolean;
  /** Reached in the last sync round. */
  online?: boolean;
}

export interface JoinRequest {
  id: string;
  device: string;
  name: string;
  role: MemberRole;
  at: number;
}

export interface WorkspaceState {
  id: string;
  name: string;
  kind: 'personal' | 'team';
  me: { id: string; name: string };
  channels: Channel[];
  agents: Agent[];
  advisors: Advisor[];
  /** Tokens each advisor spent today on this computer. */
  spend: Record<string, number>;
  /** Jobs still running or waiting, so a reloaded window shows them. */
  active: Job[];
  /** Team workspaces: the members, this device's role, and join requests waiting for an admin. */
  members?: MemberInfo[];
  role?: MemberRole;
  joins?: JoinRequest[];
  /** Lessons of this computer's specialists that wait for their owner. */
  lessons?: LessonSuggestion[];
  /** Routines of the workspace; `last` and `next` only on the ones this computer runs. */
  routines?: RoutineView[];
  /**
   * Per channel: messages that arrived since this person last had it open, and whether one of them mentions
   * them (`@name`). Kept on this computer; channels with nothing new are left out.
   */
  unread?: Record<string, { count: number; mention?: boolean }>;
  /** This app's address for other members, once it listens. */
  address?: string;
}

/**
 * Goal mode (PLAN.md 5.5): the agent writes a plan, a person approves it (with comments on any step), then the
 * agent works step by step, each step reported and followed by the done check, until the goal is done, the
 * budget runs out, or someone stops it.
 * - `planning`: the agent is writing the plan.
 * - `review`: the plan waits for a person.
 * - `running`: steps are being worked on.
 * - `paused`: stopped by a limit or a failure; a person can continue it.
 */
export const GOAL_STATES = ['planning', 'review', 'running', 'paused', 'done', 'failed', 'stopped'] as const;
export type GoalState = (typeof GOAL_STATES)[number];

export interface GoalStep {
  id: string;
  text: string;
  state: 'pending' | 'running' | 'done' | 'failed';
  jobId?: string;
  /** Extra steps Serai adds when the plan is done but the done check still fails. */
  fix?: boolean;
}

export interface GoalComment {
  /** The step the comment is on; none for the plan as a whole. */
  stepId?: string;
  text: string;
}

export interface GoalBudget {
  /** Most step jobs (plan steps and fixes). */
  steps: number;
  /** Most minutes of running time. */
  minutes: number;
  /** Most tokens (new input and output) over all jobs; none means no limit. */
  tokens?: number;
}

export type GoalPause =
  | 'budget_steps'
  | 'budget_time'
  | 'budget_tokens'
  | 'job_failed'
  | 'agent_missing'
  | 'no_plan'
  | 'interrupted';

export interface Goal {
  id: string;
  channelId: string;
  agentId: string;
  /** The person's `/goal` message. */
  requestId: string;
  text: string;
  state: GoalState;
  steps: GoalStep[];
  comments: GoalComment[];
  budget: GoalBudget;
  /** A shell command run in the agent's folder after each step; exit code 0 means done. */
  check?: string;
  lastCheck?: { at: number; ok: boolean; output: string };
  /** The goal's own git worktree and branch, when it runs apart from the agent's folder. */
  worktree?: { path: string; branch: string; removed?: boolean };
  used: { steps: number; tokens: number; ms: number };
  pause?: GoalPause;
  planJobId?: string;
  created: number;
  ended?: number;
}

export interface GoalInput {
  channelId: string;
  agentId: string;
  text: string;
  budget: GoalBudget;
  check?: string;
  /** Run in a new git worktree on a branch of its own. */
  worktree?: boolean;
}

/** Memory sections (PLAN.md 5.7): two personal ones on this computer, three shared with the workspace. */
export const PERSONAL_SECTIONS = ['profile', 'notes'] as const;
export const WORKSPACE_SECTIONS = ['decisions', 'conventions', 'glossary'] as const;
export type MemorySection = (typeof PERSONAL_SECTIONS)[number] | (typeof WORKSPACE_SECTIONS)[number];
/** Characters per section: small enough to go into every prompt. */
export const MEMORY_LIMITS: Record<MemorySection, number> = {
  profile: 1500,
  notes: 3000,
  decisions: 4000,
  conventions: 3000,
  glossary: 3000,
};

export interface MemorySuggestion {
  id: string;
  section: MemorySection;
  text: string;
  /** Who suggested it, and where: shown next to it. */
  source: { kind: 'agent' | 'advisor' | 'person'; name: string; channelId?: string; jobId?: string };
  at: number;
  /** What looked suspicious in it (`instructions`, `role`, `secret`, ...). */
  flags?: string[];
}

export interface MemoryState {
  personal: { profile: string; notes: string };
  workspace: { decisions: string; conventions: string; glossary: string };
  suggestions: MemorySuggestion[];
  limits: Record<MemorySection, number>;
}

export const RECORD_KINDS = ['idea', 'reference', 'command'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];
export const IDEA_STATUSES = ['new', 'later', 'doing', 'done', 'dropped'] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

/** Saved things (Kayıtlar): ideas, reference images with notes, commands (prompts with {variables}). */
export interface RecordItem {
  id: string;
  kind: RecordKind;
  title: string;
  body: string;
  tags: string[];
  status?: IdeaStatus;
  /** References: the image file in the workspace's blob folder. */
  image?: { blob: string; mime: string; width?: number; height?: number };
  /** The message it was saved from, if any. */
  sourceId?: string;
  /** Commands: shown as a button above the message box. */
  pinned?: boolean;
  created: number;
  updated: number;
}

export interface RecordInput {
  id?: string;
  kind: RecordKind;
  title: string;
  body?: string;
  tags?: string[];
  status?: IdeaStatus;
  /** A new image for a reference, as a data URL (png, jpeg, webp, gif; at most 10 MB). */
  imageData?: string;
  width?: number;
  height?: number;
  sourceId?: string;
  pinned?: boolean;
}

/**
 * A project (PLAN.md 5.13): a git repository every member points at their own clone of. Fabrika's per-game folder
 * generalized: its status page is `progress.md`, its areas are `split.md`. The folder is this computer's only.
 */
export interface Project {
  id: string;
  name: string;
  description: string;
  /**
   * Who mostly works on what. A record that every job is told about, never a lock: anyone may change any area when
   * asked (Fabrika dropped its ownership rules on 2026-10-16 for this reason) and says so when it is someone else's.
   */
  areas: ProjectArea[];
  created: number;
  updated: number;
}

export interface ProjectArea {
  /** A folder or file pattern inside the repository, as people write it (`src/ui`, `docs/*.md`). */
  path: string;
  /** The member (device id) who mostly works there; none for a shared area. */
  member?: string;
  note: string;
}

/** The project's status page: where it stands, kept current by people and by agents after their work. */
export interface ProjectStatus {
  /** The project's id. */
  id: string;
  /** "Where we left off": a short paragraph. */
  leftOff: string;
  milestones: { text: string; done: boolean }[];
  /** What comes next, in order. */
  next: string[];
  updated: number;
  /** Who changed it last: a person's or an agent's name. */
  by?: string;
}

export const ProjectInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(60),
  description: z.string().max(2000).default(''),
  areas: z
    .array(
      z.object({
        path: z.string().trim().min(1).max(200),
        member: z.string().max(64).optional(),
        note: z.string().max(300).default(''),
      }),
    )
    .max(40)
    .default([]),
  /** This computer's clone of the repository. */
  folder: z.string().max(1000).optional(),
});
export type ProjectInput = z.input<typeof ProjectInputSchema>;

export const ProjectStatusInputSchema = z.object({
  id: z.string().min(1),
  leftOff: z.string().max(4000).optional(),
  milestones: z
    .array(z.object({ text: z.string().trim().min(1).max(300), done: z.boolean() }))
    .max(60)
    .optional(),
  next: z.array(z.string().trim().min(1).max(300)).max(40).optional(),
});
export type ProjectStatusInput = z.input<typeof ProjectStatusInputSchema>;

/** The git state of this computer's clone. */
export interface GitState {
  /** False when the folder is missing or not a git repository. */
  repo: boolean;
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  /** Changed, added or deleted files that are not committed. */
  changes?: number;
  untracked?: number;
  commits?: { hash: string; date: string; author: string; subject: string }[];
  /** When the remote was last fetched by Serai (ms). */
  fetched?: number;
}

/** A project as one computer sees it: shared data plus this computer's folder and its git state. */
export interface ProjectView extends Project {
  status: ProjectStatus;
  folder?: string;
}

/**
 * A routine (PLAN.md 5.16): a message posted for a person at a set time on set days, as that person's standing
 * request. Its owner's computer posts it while the app runs there.
 */
export interface Routine {
  id: string;
  channelId: string;
  /** What is posted, as its owner would write it (`@test run the suite`). */
  text: string;
  /** Local time, `HH:MM`. */
  at: string;
  /** Days of the week it runs on (0 Sunday … 6 Saturday); empty means every day. */
  days: number[];
  enabled: boolean;
  /** The device that made it; only that computer posts it. */
  owner: string;
  created: number;
}

/** A routine as one computer shows it: with when it last ran here and when it is due next. */
export interface RoutineView extends Routine {
  last?: number;
  next?: number;
}

export const RoutineInputSchema = z.object({
  id: z.string().optional(),
  channelId: z.string().min(1).max(64),
  text: z.string().trim().min(1).max(4000),
  at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  enabled: z.boolean().default(true),
});
export type RoutineInput = z.input<typeof RoutineInputSchema>;

/** The workspace at a glance (the Overview page): today's numbers, the last days, the latest finished jobs. */
export interface Overview {
  today: { messages: number; jobs: number; failed: number; usage: Usage; cost: number };
  /** The last seven days, oldest first; `day` is the local date (`2026-11-10`). */
  days: { day: string; jobs: number; tokens: number }[];
  /** Jobs that ended, newest first, with the request's first line and the channel's name. */
  recent: { job: Job; request: string; channel: string }[];
}

export const CARD_STATUSES = ['todo', 'doing', 'review', 'done'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

/** A task on the board (`/todo`). Assigned to an agent it can become a job with one click. */
export interface Card {
  id: string;
  title: string;
  status: CardStatus;
  assignee?: { kind: 'person' | 'agent'; id: string };
  /** The channel the card came from; its job runs there. */
  channelId?: string;
  /** The last job started from the card. */
  jobId?: string;
  created: number;
  updated: number;
}

/** A normalized line of a job's transcript, for the live view. */
export type TranscriptEntry =
  | { t: 'text'; text: string; at: number }
  | { t: 'tool'; id: string; label: string; arg?: string; at: number }
  | { t: 'result'; id: string; ok: boolean; preview: string; at: number }
  | { t: 'steer'; text: string; at: number }
  | { t: 'denied'; label: string; arg?: string; at: number }
  | { t: 'notice'; text: string; at: number }
  | { t: 'end'; ok: boolean; error?: string; at: number };
