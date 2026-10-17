// The one interface every CLI agent is driven through. Drivers turn a CLI's own output into these events.
import { relative } from 'node:path';
import type { AgentMode, Quota, Usage } from '@lonca/protocol';
import type { Launch } from '../proc.js';

export type DriverEvent =
  | { type: 'session'; id: string }
  | { type: 'delta'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; label: string; arg?: string }
  | { type: 'tool_result'; id: string; ok: boolean; preview: string }
  | { type: 'denied'; label: string; arg?: string }
  | { type: 'usage'; usage: Partial<Usage> }
  | { type: 'quota'; quota: Quota }
  | { type: 'auth_failed'; text: string }
  | { type: 'approval'; id: string; label: string; arg?: string; detail?: string }
  | { type: 'notice'; code: string; text?: string }
  | { type: 'end'; ok: boolean; final?: string; error?: string; cost?: number; usage?: Usage; more?: boolean }
  | { type: 'exit'; code: number | null; stderr: string };

export interface SessionOptions {
  launch: Launch;
  cwd: string;
  mode: AgentMode;
  model?: string;
  /** The CLI's own session id to continue. */
  resume?: string;
  systemPrompt: string;
  env?: NodeJS.ProcessEnv;
  /** Lonca's MCP endpoint for this session, with its bearer token. */
  mcp?: { url: string; token: string };
}

/** An image given to the agent with a message: the bytes for CLIs that take them inline, the file for others. */
export interface Attachment {
  mime: string;
  data: string;
  path: string;
}

export interface AgentSession {
  /** `live`: a message sent during a turn reaches the agent at its next break. `queue`: it waits for the next turn. */
  readonly steering: 'live' | 'queue';
  readonly busy: boolean;
  send(text: string, images?: Attachment[]): void;
  /** Answers a pending approval (drivers that can ask). */
  answer?(id: string, allow: boolean): void;
  stop(): void;
  dispose(): void;
}

export type OpenSession = (opts: SessionOptions, emit: (e: DriverEvent) => void) => AgentSession;

/** A short, translatable verb for a tool (`job.tool.<label>` in the locales). */
export function toolLabel(name: string): string {
  if (name.startsWith('mcp__')) return 'tool';
  const map: Record<string, string> = {
    Read: 'read',
    Grep: 'search',
    Glob: 'search',
    LS: 'search',
    Edit: 'edit',
    MultiEdit: 'edit',
    Write: 'write',
    NotebookEdit: 'edit',
    Bash: 'command',
    PowerShell: 'command',
    WebSearch: 'web',
    WebFetch: 'fetch',
    TodoWrite: 'plan',
    Task: 'subagent',
    Agent: 'subagent',
  };
  return map[name] ?? 'tool';
}

const ARG_KEYS = ['file_path', 'path', 'command', 'pattern', 'url', 'query', 'description', 'prompt'];

/** The one argument worth showing for a tool call: a path relative to the folder, a command's first line, ... */
export function toolArg(name: string, input: unknown, cwd: string): string | undefined {
  if (name.startsWith('mcp__')) return name.slice(5).replace('__', '.');
  if (!input || typeof input !== 'object') return undefined;
  for (const key of ARG_KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    let text = value.trim();
    if (key === 'file_path' || key === 'path') {
      const rel = relative(cwd, text);
      if (rel && !rel.startsWith('..')) text = rel.replaceAll('\\', '/');
    }
    const first = text.split('\n')[0] ?? '';
    return first.length > 120 || text.includes('\n') ? `${first.slice(0, 120)}…` : first;
  }
  return undefined;
}

export function preview(content: unknown, max = 700): string {
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    text = content
      .map((b) =>
        b && typeof b === 'object' && (b as { type?: string }).type === 'text'
          ? String((b as { text?: string }).text ?? '')
          : '[image]',
      )
      .join('\n');
  }
  text = text.trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Splits a byte stream into lines. */
export class LineReader {
  private buf = '';
  constructor(private readonly onLine: (line: string) => void) {}
  push(chunk: Buffer | string): void {
    this.buf += chunk.toString();
    let i = this.buf.indexOf('\n');
    while (i >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (line) this.onLine(line);
      i = this.buf.indexOf('\n');
    }
  }
}

/** The environment for a CLI: never Electron's run-as-Node switch unless the launch needs it. */
export function cliEnv(opts: SessionOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...opts.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return { ...env, ...opts.launch.env };
}
