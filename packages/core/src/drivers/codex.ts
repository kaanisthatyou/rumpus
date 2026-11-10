// OpenAI Codex through `codex exec --json`: one process per turn, the prompt on stdin, JSONL events on stdout,
// `exec resume <thread>` to continue. A message sent mid-turn waits for the next turn.
// Checked against codex-cli 0.162.1 without a login: the flags are accepted, and a failing turn sends `error`
// events (retries, then the cause) before `turn.failed`, which is what ends it.
import { type ChildProcess, spawn } from 'node:child_process';
import type { AgentMode, Usage } from '@lonca/protocol';
import { killTree } from '../proc.js';
import {
  type AgentSession,
  type Attachment,
  cliEnv,
  type DriverEvent,
  LineReader,
  type OpenSession,
  preview,
  type SessionOptions,
} from './types.js';

export function codexSandbox(mode: AgentMode): string {
  return mode === 'full' ? 'danger-full-access' : mode === 'edit' ? 'workspace-write' : 'read-only';
}

export function codexArgs(opts: SessionOptions, images: string[] = []): string[] {
  return [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--sandbox',
    codexSandbox(opts.mode),
    ...(opts.model ? ['-m', opts.model] : []),
    // Serai's MCP endpoint for this run only, as config overrides; the token travels in an environment variable.
    ...(opts.mcp
      ? [
          '-c',
          `mcp_servers.serai.url="${opts.mcp.url}"`,
          '-c',
          'mcp_servers.serai.bearer_token_env_var="LONCA_MCP_TOKEN"',
          // A connector call may wait for a person on the job card (up to ten minutes).
          '-c',
          'mcp_servers.serai.tool_timeout_sec=900',
        ]
      : []),
    ...images.flatMap((p) => ['--image', p]),
    ...(opts.resume ? ['resume', opts.resume] : []),
    '-',
  ];
}

export class CodexParser {
  private final = '';
  constructor(private readonly emit: (e: DriverEvent) => void) {}

  line(raw: string): void {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const item = (ev.item ?? {}) as Record<string, unknown>;
    const id = String(item.id ?? '');
    switch (ev.type) {
      case 'thread.started':
        if (typeof ev.thread_id === 'string') this.emit({ type: 'session', id: ev.thread_id });
        return;
      case 'item.started':
        if (item.type === 'command_execution')
          this.emit({ type: 'tool', id, label: 'command', arg: firstLine(item.command) });
        else if (item.type === 'mcp_tool_call')
          this.emit({ type: 'tool', id, label: 'tool', arg: `${item.server ?? ''}.${item.tool ?? ''}` });
        else if (item.type === 'web_search') this.emit({ type: 'tool', id, label: 'web', arg: firstLine(item.query) });
        return;
      case 'item.completed':
        if (item.type === 'agent_message' && typeof item.text === 'string') {
          this.final = item.text;
          this.emit({ type: 'text', text: item.text });
        } else if (item.type === 'command_execution') {
          const ok = item.exit_code === 0 || (item.exit_code === undefined && item.status === 'completed');
          this.emit({ type: 'tool_result', id, ok, preview: preview(item.aggregated_output) });
        } else if (item.type === 'file_change') {
          const changes = Array.isArray(item.changes) ? (item.changes as { path?: string }[]) : [];
          const arg = changes
            .map((c) => c.path)
            .filter(Boolean)
            .join(', ');
          this.emit({ type: 'tool', id, label: 'edit', ...(arg ? { arg } : {}) });
          this.emit({ type: 'tool_result', id, ok: item.status !== 'failed', preview: '' });
        } else if (item.type === 'mcp_tool_call' || item.type === 'web_search') {
          this.emit({ type: 'tool_result', id, ok: item.status !== 'failed', preview: '' });
        }
        return;
      case 'turn.completed': {
        const u = (ev.usage ?? {}) as Record<string, number>;
        const cached = u.cached_input_tokens ?? 0;
        const usage: Usage = { in: Math.max(0, (u.input_tokens ?? 0) - cached), cached, out: u.output_tokens ?? 0 };
        this.emit({ type: 'usage', usage });
        this.emit({ type: 'end', ok: true, ...(this.final ? { final: this.final } : {}), usage });
        this.final = '';
        return;
      }
      case 'error': {
        // Not the end of the turn: retries ("Reconnecting... 2/5") and the cause come before turn.failed.
        const message = String(ev.message ?? '');
        if (/^reconnecting/i.test(message))
          this.emit({ type: 'notice', code: 'reconnecting', text: message.slice(0, 120) });
        return;
      }
      case 'turn.failed': {
        const err = (ev.error ?? {}) as { message?: string };
        const message = String(err.message ?? 'error');
        if (/\b401\b|unauthorized/i.test(message)) this.emit({ type: 'auth_failed', text: message });
        this.emit({ type: 'end', ok: false, error: message });
        this.final = '';
        return;
      }
    }
  }
}

function firstLine(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const line = v.trim().split('\n')[0] ?? '';
  return line.length > 120 ? `${line.slice(0, 120)}…` : line;
}

class CodexSession implements AgentSession {
  readonly steering = 'queue' as const;
  private proc: ChildProcess | undefined;
  private threadId: string | undefined;
  private first = true;

  constructor(
    private readonly opts: SessionOptions,
    private readonly emit: (e: DriverEvent) => void,
  ) {
    this.threadId = opts.resume;
    this.first = !opts.resume;
  }

  get busy(): boolean {
    return this.proc !== undefined;
  }

  send(text: string, images: Attachment[] = []): void {
    if (this.proc) return;
    const opts = { ...this.opts, ...(this.threadId ? { resume: this.threadId } : {}) };
    const args = codexArgs(
      opts,
      images.map((i) => i.path),
    );
    const child = spawn(opts.launch.file, [...opts.launch.args, ...args], {
      cwd: opts.cwd,
      env: { ...cliEnv(opts), ...(opts.mcp ? { LONCA_MCP_TOKEN: opts.mcp.token } : {}) },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    let ended = false;
    const parser = new CodexParser((e) => {
      if (e.type === 'session') this.threadId = e.id;
      if (e.type === 'end') ended = true;
      this.emit(e);
    });
    const lines = new LineReader((l) => parser.line(l));
    child.stdout?.on('data', (c: Buffer) => lines.push(c));
    child.stderr?.on('data', (c: Buffer) => {
      stderr = (stderr + c.toString()).slice(-2000);
    });
    child.on('error', () => {
      if (this.proc === child) this.proc = undefined;
      this.emit({ type: 'exit', code: null, stderr: 'spawn_failed' });
    });
    child.on('close', (code) => {
      if (this.proc !== child) return;
      this.proc = undefined;
      if (!ended) this.emit({ type: 'exit', code, stderr: stderr.trim() });
    });
    this.proc = child;
    // Codex has no flag to append to its system prompt: the instructions lead the first turn.
    const prompt = this.first ? `<instructions>\n${opts.systemPrompt}\n</instructions>\n\n${text}` : text;
    this.first = false;
    child.stdin?.end(prompt);
  }

  stop(): void {
    const proc = this.proc;
    this.proc = undefined;
    killTree(proc?.pid);
  }

  dispose(): void {
    this.stop();
  }
}

export const openCodex: OpenSession = (opts, emit) => new CodexSession(opts, emit);
