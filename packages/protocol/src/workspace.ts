// Workspace data: channels, agents, messages, jobs. Shared by the core and every client.
import { z } from 'zod';
import { CLI_KINDS } from './kinds.js';

/** The autonomy ladder, the same three words for every CLI: read, edit, full. */
export const AGENT_MODES = ['read', 'edit', 'full'] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

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
});
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

export interface WorkspaceState {
  id: string;
  name: string;
  me: { id: string; name: string };
  channels: Channel[];
  agents: Agent[];
  /** Jobs still running or waiting, so a reloaded window shows them. */
  active: Job[];
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
