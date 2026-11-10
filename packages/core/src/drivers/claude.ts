// Claude Code through its stream-json mode, as Fabrika drives it: one long-lived `claude -p` per conversation,
// user messages as JSON lines on stdin (a message sent mid-turn is the steer), events as JSON lines on stdout.
// Stopping kills the process; the next message resumes the same session with --resume.
import { type ChildProcess, spawn } from 'node:child_process';
import { type AgentMode, MCP_NAME, type Quota, type Usage } from '@lonca/protocol';
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
  toolArg,
  toolLabel,
} from './types.js';

const READ_TOOLS = ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'TodoWrite'];
const EDIT_TOOLS = [...READ_TOOLS, 'Edit', 'Write', 'NotebookEdit', 'Bash'];
const IDLE_MS = 20 * 60 * 1000;

/**
 * The autonomy ladder in Claude Code's terms. At read and edit, what would prompt is asked of Serai over stdio
 * (`control_request` / `can_use_tool`) and shown on the job card for a person to allow or deny.
 */
export function claudeModeArgs(mode: AgentMode): string[] {
  if (mode === 'full') return ['--permission-mode', 'bypassPermissions'];
  return [
    '--tools',
    (mode === 'read' ? READ_TOOLS : EDIT_TOOLS).join(','),
    '--permission-mode',
    mode === 'edit' ? 'acceptEdits' : 'manual',
    '--permission-prompts',
    'host',
    '--permission-prompt-tool',
    'stdio',
  ];
}

export function claudeArgs(opts: SessionOptions): string[] {
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--strict-mcp-config',
    '--append-system-prompt',
    opts.systemPrompt,
    ...claudeModeArgs(opts.mode),
    // Serai's own tools touch Serai's data, not files: they run without asking at every level.
    ...(opts.mcp
      ? [
          '--mcp-config',
          JSON.stringify({
            mcpServers: {
              [MCP_NAME]: { type: 'http', url: opts.mcp.url, headers: { Authorization: `Bearer ${opts.mcp.token}` } },
            },
          }),
          '--allowedTools',
          `mcp__${MCP_NAME}`,
        ]
      : []),
    ...(opts.resume ? ['--resume', opts.resume] : []),
    ...(opts.model ? ['--model', opts.model] : []),
  ];
}

/** Both shapes Claude Code has used for its rate-limit event, merged into one quota. */
export function quotaFrom(info: Record<string, unknown>, previous?: Quota): Quota | undefined {
  const windows = { ...(previous?.windows ?? {}) };
  const unified = info.unifiedWindows as Record<string, { utilization?: number; resetsAt?: number }> | undefined;
  if (unified && typeof unified === 'object') {
    for (const [k, v] of Object.entries(unified)) {
      if (v && typeof v === 'object')
        windows[k] = { used: Number(v.utilization ?? 0), ...(v.resetsAt ? { resets: Number(v.resetsAt) } : {}) };
    }
  } else if (typeof info.rateLimitType === 'string' && typeof info.utilization === 'number') {
    windows[info.rateLimitType] = {
      used: info.utilization,
      ...(typeof info.resetsAt === 'number' ? { resets: info.resetsAt } : {}),
    };
  } else {
    return undefined;
  }
  return { windows, ...(typeof info.status === 'string' ? { status: info.status } : {}), at: Date.now() };
}

/** Turns one stream-json line into driver events. Exported for tests with recorded output. */
export class ClaudeParser {
  private costBase = 0;
  private quota: Quota | undefined;
  private readonly toolInputs = new Map<string, { label: string; arg?: string }>();

  /** Inputs of tool calls waiting for approval, by request id (the answer must carry them back). */
  readonly pending = new Map<string, unknown>();

  constructor(
    private readonly cwd: string,
    private readonly emit: (e: DriverEvent) => void,
    /** Control requests Serai does not handle get an error answer, so the CLI never waits on them. */
    private readonly unsupported: (requestId: string) => void = () => {},
  ) {}

  line(raw: string): void {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = ev.type;
    const nested = Boolean(ev.parent_tool_use_id);
    if (type === 'control_request') {
      const req = (ev.request ?? {}) as Record<string, unknown>;
      const id = String(ev.request_id ?? '');
      if (req.subtype === 'can_use_tool' && id) {
        const name = String(req.tool_name ?? '');
        const arg = toolArg(name, req.input, this.cwd);
        this.pending.set(id, req.input);
        this.emit({
          type: 'approval',
          id,
          label: toolLabel(name),
          ...(arg ? { arg } : {}),
          ...(typeof req.description === 'string' ? { detail: req.description } : {}),
        });
      } else if (id) {
        this.unsupported(id);
      }
      return;
    }
    if (type === 'rate_limit_event') {
      const quota = quotaFrom((ev.rate_limit_info as Record<string, unknown>) ?? {}, this.quota);
      if (quota) {
        this.quota = quota;
        this.emit({ type: 'quota', quota });
      }
      return;
    }
    if (type === 'system') {
      if (ev.subtype === 'init' && typeof ev.session_id === 'string') this.emit({ type: 'session', id: ev.session_id });
      else if (ev.subtype === 'permission_denied') {
        const known = this.toolInputs.get(String(ev.tool_use_id ?? ''));
        const name = String(ev.tool_name ?? '');
        this.emit({
          type: 'denied',
          label: known?.label ?? toolLabel(name),
          ...(known?.arg ? { arg: known.arg } : {}),
        });
      } else if (ev.subtype === 'compact_boundary') this.emit({ type: 'notice', code: 'compacted' });
      return;
    }
    if (type === 'stream_event') {
      const e = (ev.event ?? {}) as Record<string, unknown>;
      if (e.type === 'message_start') {
        const u = ((e.message as Record<string, unknown>)?.usage ?? {}) as Record<string, number>;
        this.emit({
          type: 'usage',
          usage: {
            in: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
            cached: u.cache_read_input_tokens ?? 0,
          },
        });
      } else if (e.type === 'message_delta') {
        const out = ((e.usage ?? {}) as Record<string, number>).output_tokens;
        if (out) this.emit({ type: 'usage', usage: { out } });
      } else if (e.type === 'content_block_delta' && !nested) {
        const d = (e.delta ?? {}) as Record<string, unknown>;
        if (d.type === 'text_delta' && typeof d.text === 'string' && d.text) this.emit({ type: 'delta', text: d.text });
      }
      return;
    }
    if (type === 'assistant') {
      const message = (ev.message ?? {}) as { content?: Record<string, unknown>[] };
      if (ev.error === 'authentication_failed') {
        const text = message.content?.find((b) => b.type === 'text')?.text;
        this.emit({ type: 'auth_failed', text: typeof text === 'string' ? text : '' });
      }
      for (const b of message.content ?? []) {
        if (b.type === 'text' && !nested && typeof b.text === 'string' && b.text.trim()) {
          this.emit({ type: 'text', text: b.text });
        } else if (b.type === 'tool_use') {
          const name = String(b.name ?? '');
          const label = toolLabel(name);
          const arg = toolArg(name, b.input, this.cwd);
          this.toolInputs.set(String(b.id), { label, ...(arg ? { arg } : {}) });
          this.emit({ type: 'tool', id: String(b.id), label, ...(arg ? { arg } : {}) });
        }
      }
      return;
    }
    if (type === 'user') {
      const content = (ev.message as { content?: unknown })?.content;
      if (!Array.isArray(content)) return;
      for (const b of content as Record<string, unknown>[]) {
        if (b.type === 'tool_result') {
          this.emit({ type: 'tool_result', id: String(b.tool_use_id), ok: !b.is_error, preview: preview(b.content) });
        }
      }
      return;
    }
    if (type === 'result') {
      const total = Number(ev.total_cost_usd ?? 0);
      const cost = Math.max(0, total - this.costBase);
      this.costBase = total;
      const u = (ev.usage ?? {}) as Record<string, number>;
      const usage: Usage = {
        in: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        cached: u.cache_read_input_tokens ?? 0,
        out: u.output_tokens ?? 0,
      };
      const isError = Boolean(ev.is_error);
      this.emit({
        type: 'end',
        ok: !isError,
        ...(typeof ev.result === 'string' && ev.result ? (isError ? { error: ev.result } : { final: ev.result }) : {}),
        ...(isError && !ev.result ? { error: String(ev.subtype ?? 'error') } : {}),
        cost: Math.round(cost * 10_000) / 10_000,
        usage,
        // Messages sent mid-turn wait as turns of their own: the job goes on until they are answered.
        ...(Number(ev.queued_turn_count ?? 0) > 0 ? { more: true } : {}),
      });
    }
  }
}

class ClaudeSession implements AgentSession {
  readonly steering = 'live' as const;
  private proc: ChildProcess | undefined;
  private sessionId: string | undefined;
  private turn = false;
  private idle: NodeJS.Timeout | undefined;
  private stderr = '';
  private warnedTrust = false;
  private parser: ClaudeParser | undefined;

  constructor(
    private readonly opts: SessionOptions,
    private readonly emit: (e: DriverEvent) => void,
  ) {
    this.sessionId = opts.resume;
  }

  get busy(): boolean {
    return this.turn;
  }

  private spawn(): ChildProcess {
    const opts = { ...this.opts, ...(this.sessionId ? { resume: this.sessionId } : {}) };
    const child = spawn(opts.launch.file, [...opts.launch.args, ...claudeArgs(opts)], {
      cwd: opts.cwd,
      // A connector call may wait for a person on the job card (up to ten minutes).
      env: { ...cliEnv(opts), ...(opts.mcp ? { MCP_TOOL_TIMEOUT: '900000' } : {}) },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.stderr = '';
    const write = (obj: unknown) => child.stdin?.write(`${JSON.stringify(obj)}\n`);
    const parser = new ClaudeParser(
      opts.cwd,
      (e) => {
        if (e.type === 'session') this.sessionId = e.id;
        if (e.type === 'end' && !e.more) this.turn = false;
        this.emit(e);
        if (e.type === 'end' && !e.more) this.armIdle();
      },
      (requestId) =>
        write({
          type: 'control_response',
          response: { subtype: 'error', request_id: requestId, error: 'unsupported' },
        }),
    );
    this.parser = parser;
    const lines = new LineReader((line) => parser.line(line));
    child.stdout?.on('data', (c: Buffer) => lines.push(c));
    child.stderr?.on('data', (c: Buffer) => {
      const text = c.toString();
      if (text.includes('has not been trusted') && !this.warnedTrust) {
        this.warnedTrust = true;
        this.emit({ type: 'notice', code: 'untrusted_folder' });
      }
      this.stderr = (this.stderr + text).slice(-2000);
    });
    child.on('error', () => {
      if (this.proc === child) this.proc = undefined;
      this.turn = false;
      this.emit({ type: 'exit', code: null, stderr: 'spawn_failed' });
    });
    child.on('close', (code) => {
      if (this.proc !== child) return;
      this.proc = undefined;
      const wasBusy = this.turn;
      this.turn = false;
      if (wasBusy) this.emit({ type: 'exit', code, stderr: this.stderr.trim() });
    });
    this.proc = child;
    return child;
  }

  private armIdle(): void {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.dispose(), IDLE_MS);
    this.idle.unref?.();
  }

  send(text: string, images: Attachment[] = []): void {
    clearTimeout(this.idle);
    const content = [
      { type: 'text', text },
      ...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } })),
    ];
    const line = `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`;
    const proc = this.proc && this.proc.exitCode === null ? this.proc : this.spawn();
    this.turn = true;
    proc.stdin?.write(line);
  }

  answer(id: string, allow: boolean): void {
    const input = this.parser?.pending.get(id);
    this.parser?.pending.delete(id);
    const response = allow
      ? { behavior: 'allow', updatedInput: input ?? {} }
      : { behavior: 'deny', message: 'A person denied this in Serai.' };
    this.proc?.stdin?.write(
      `${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: id, response } })}\n`,
    );
  }

  stop(): void {
    const proc = this.proc;
    this.proc = undefined;
    this.turn = false;
    killTree(proc?.pid);
  }

  dispose(): void {
    clearTimeout(this.idle);
    this.stop();
  }
}

export const openClaude: OpenSession = (opts, emit) => new ClaudeSession(opts, emit);
