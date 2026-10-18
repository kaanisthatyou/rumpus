// Talks to model providers over HTTP: OpenAI-style chat completions or Anthropic's messages API, streamed, with a
// chain of keys (the next key on 401, 403 or 429). Runs in Electron's main process, where the keys are.
import type { LlmMessage, LlmResult, LlmTool, ProviderWire } from '@lonca/protocol';

export type ProviderErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'provider_bad_url'
  | 'provider_bad_key'
  | 'provider_storage'
  | 'provider_no_key'
  | 'provider_auth'
  | 'provider_rate_limited'
  | 'provider_unreachable'
  | 'provider_timeout'
  | 'provider_cancelled'
  | 'provider_bad_response'
  | 'provider_no_tools'
  | 'provider_refused';

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message?: string,
    readonly status?: number,
  ) {
    super(message ?? code);
    this.name = 'ProviderError';
  }
}

export interface Endpoint {
  baseUrl: string;
  wire: ProviderWire;
  /** Plain keys, in the order to try. Empty for servers without auth. */
  keys: string[];
  /** Index of the key that worked last; tried first. */
  start?: number;
}

export interface CompleteOptions {
  model: string;
  system?: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  onDelta?: (text: string) => void;
}

const RETRY_NEXT_KEY = new Set([401, 403, 429]);

function url(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path}`;
}

function headers(wire: ProviderWire, key: string | undefined): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  if (wire === 'anthropic') {
    h['anthropic-version'] = '2023-06-01';
    if (key) h['x-api-key'] = key;
  } else if (key) {
    h.authorization = `Bearer ${key}`;
  }
  return h;
}

/** Tries each key in turn; returns the response that is not an auth or rate refusal, and the key index used. */
async function withKeys(
  ep: Endpoint,
  attempt: (key: string | undefined) => Promise<Response>,
): Promise<{ res: Response; index: number }> {
  const keys = ep.keys.length ? ep.keys : [undefined];
  const start = Math.min(Math.max(ep.start ?? 0, 0), keys.length - 1);
  let limited = false;
  let lastStatus = 0;
  for (let n = 0; n < keys.length; n++) {
    const index = (start + n) % keys.length;
    const res = await attempt(keys[index]);
    if (!RETRY_NEXT_KEY.has(res.status)) return { res, index };
    lastStatus = res.status;
    if (res.status === 429) limited = true;
    await res.body?.cancel().catch(() => {});
  }
  if (limited) throw new ProviderError('provider_rate_limited', undefined, 429);
  throw new ProviderError(ep.keys.length ? 'provider_auth' : 'provider_no_key', undefined, lastStatus);
}

function fetchError(e: unknown, signal: AbortSignal | undefined): ProviderError {
  if (e instanceof ProviderError) return e;
  const name = (e as { name?: string })?.name;
  if (name === 'TimeoutError') return new ProviderError('provider_timeout');
  if (name === 'AbortError' && signal?.aborted) return new ProviderError('provider_cancelled');
  return new ProviderError('provider_unreachable', String((e as Error)?.message ?? e));
}

async function refusal(res: Response): Promise<ProviderError> {
  const body = (await res.text().catch(() => '')).slice(0, 400);
  let message = body;
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    message = (typeof j.error === 'string' ? j.error : j.error?.message) ?? j.message ?? body;
  } catch {}
  return new ProviderError('provider_refused', `${res.status} ${message}`.trim(), res.status);
}

/** Model ids from `GET /models`, tolerant of the shapes servers use (`data` or `models`, `id` or `name`). */
export function parseModels(json: unknown): string[] {
  const j = (json ?? {}) as { data?: unknown; models?: unknown };
  const list = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : Array.isArray(json) ? json : [];
  const ids = list
    .map((m) =>
      typeof m === 'string' ? m : ((m as { id?: unknown; name?: unknown })?.id ?? (m as { name?: unknown })?.name),
    )
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .map((id) => id.replace(/^models\//, ''));
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

export async function listModels(
  ep: Endpoint,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ models: string[]; index: number }> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    ...(opts.signal ? [opts.signal] : []),
  ]);
  try {
    const path = ep.wire === 'anthropic' ? 'models?limit=1000' : 'models';
    const { res, index } = await withKeys(ep, (key) =>
      fetch(url(ep.baseUrl, path), { headers: headers(ep.wire, key), signal }),
    );
    if (!res.ok) throw await refusal(res);
    const json = await res.json().catch(() => {
      throw new ProviderError('provider_bad_response');
    });
    return { models: parseModels(json), index };
  } catch (e) {
    throw fetchError(e, opts.signal);
  }
}

/** Server-sent events: calls `onData` with each `data:` payload. */
async function readSse(res: Response, onData: (data: string) => void): Promise<void> {
  if (!res.body) throw new ProviderError('provider_bad_response', 'no body');
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  const flush = () => {
    if (data.length) onData(data.join('\n'));
    data = [];
  };
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (line === '') flush();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      nl = buffer.indexOf('\n');
    }
  }
  if (buffer.startsWith('data:')) data.push(buffer.slice(5).trimStart());
  flush();
}

const estimate = (text: string) => Math.ceil(text.length / 4);

/** Plain turns for the streamed path (no tools): tool turns become text the model can still read. */
function plainTurns(messages: LlmMessage[]): { role: 'user' | 'assistant'; content: string }[] {
  return messages.map((m) =>
    m.role === 'tool'
      ? { role: 'user', content: `[${m.name} result]\n${m.content}` }
      : { role: m.role, content: m.content },
  );
}

function openaiTurns(messages: LlmMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.callId, content: m.content };
    if (m.role === 'assistant' && m.calls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.calls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args) },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

/** Anthropic wants tool results in a user turn, several results of one round together. */
function anthropicTurns(messages: LlmMessage[]): unknown[] {
  const out: { role: string; content: unknown }[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.callId, content: m.content };
      const last = out.at(-1);
      if (last?.role === 'user' && Array.isArray(last.content)) (last.content as unknown[]).push(block);
      else out.push({ role: 'user', content: [block] });
    } else if (m.role === 'assistant' && m.calls?.length) {
      out.push({
        role: 'assistant',
        content: [
          ...(m.content ? [{ type: 'text', text: m.content }] : []),
          ...m.calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args })),
        ],
      });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

const argsOf = (raw: unknown): Record<string, unknown> => {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    const v = JSON.parse(String(raw ?? '{}')) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** One turn with tools, not streamed: the text and the tool calls the model asks for. */
async function completeWithTools(
  ep: Endpoint,
  opts: CompleteOptions & { tools: LlmTool[] },
  signal: AbortSignal,
): Promise<LlmResult & { index: number }> {
  const maxTokens = opts.maxTokens ?? 1024;
  const anthropic = ep.wire === 'anthropic';
  const body = JSON.stringify(
    anthropic
      ? {
          model: opts.model,
          max_tokens: maxTokens,
          ...(opts.system ? { system: opts.system } : {}),
          messages: anthropicTurns(opts.messages),
          tools: opts.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        }
      : {
          model: opts.model,
          messages: [...(opts.system ? [{ role: 'system', content: opts.system }] : []), ...openaiTurns(opts.messages)],
          tools: opts.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
          max_tokens: maxTokens,
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        },
  );
  const { res, index } = await withKeys(ep, (key) =>
    fetch(url(ep.baseUrl, anthropic ? 'messages' : 'chat/completions'), {
      method: 'POST',
      headers: headers(ep.wire, key),
      body,
      signal,
    }),
  );
  if (!res.ok) {
    const err = await refusal(res);
    // Models and servers without tool support say so in a 400 (or 404/422 on some local servers).
    if ([400, 404, 422].includes(res.status) && /tool|function/i.test(err.message)) {
      throw new ProviderError('provider_no_tools', err.message, res.status);
    }
    throw err;
  }
  const json = (await res.json().catch(() => {
    throw new ProviderError('provider_bad_response');
  })) as Record<string, unknown>;
  if (anthropic) {
    const blocks = (json.content ?? []) as {
      type?: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
    }[];
    const u = (json.usage ?? {}) as Record<string, number>;
    const calls = blocks
      .filter((b) => b.type === 'tool_use' && b.id && b.name)
      .map((b) => ({ id: String(b.id), name: String(b.name), args: argsOf(b.input) }));
    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    return {
      text,
      ...(calls.length ? { calls } : {}),
      usage: finish(
        {
          in: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
          out: u.output_tokens ?? 0,
        },
        opts,
        text,
      ),
      index,
    };
  }
  const message = ((json.choices as { message?: Record<string, unknown> }[] | undefined)?.[0]?.message ?? {}) as {
    content?: unknown;
    tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[];
  };
  const text = typeof message.content === 'string' ? message.content : '';
  const calls = (message.tool_calls ?? [])
    .filter((c) => c.function?.name)
    .map((c, i) => ({
      id: String(c.id ?? `call_${i}`),
      name: String(c.function?.name),
      args: argsOf(c.function?.arguments),
    }));
  const u = json.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  return {
    text,
    ...(calls.length ? { calls } : {}),
    usage: finish(u ? { in: u.prompt_tokens ?? 0, out: u.completion_tokens ?? 0 } : {}, opts, text),
    index,
  };
}

export async function complete(ep: Endpoint, opts: CompleteOptions): Promise<LlmResult & { index: number }> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    ...(opts.signal ? [opts.signal] : []),
  ]);
  if (opts.tools?.length) {
    try {
      return await completeWithTools(ep, { ...opts, tools: opts.tools }, signal);
    } catch (e) {
      throw fetchError(e, opts.signal);
    }
  }
  const maxTokens = opts.maxTokens ?? 1024;
  let text = '';
  let usage: { in?: number; out?: number } = {};
  const add = (t: string) => {
    if (!t) return;
    text += t;
    opts.onDelta?.(t);
  };
  try {
    if (ep.wire === 'anthropic') {
      const body = JSON.stringify({
        model: opts.model,
        max_tokens: maxTokens,
        ...(opts.system ? { system: opts.system } : {}),
        messages: plainTurns(opts.messages),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        stream: true,
      });
      const { res, index } = await withKeys(ep, (key) =>
        fetch(url(ep.baseUrl, 'messages'), { method: 'POST', headers: headers(ep.wire, key), body, signal }),
      );
      if (!res.ok) throw await refusal(res);
      await readSse(res, (data) => {
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(data) as Record<string, unknown>;
        } catch {
          return;
        }
        if (ev.type === 'message_start') {
          const u = ((ev.message as { usage?: Record<string, number> })?.usage ?? {}) as Record<string, number>;
          usage.in = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        } else if (ev.type === 'content_block_delta') {
          const d = ev.delta as { type?: string; text?: string };
          if (d?.type === 'text_delta' && typeof d.text === 'string') add(d.text);
        } else if (ev.type === 'message_delta') {
          const u = ev.usage as { output_tokens?: number } | undefined;
          if (typeof u?.output_tokens === 'number') usage.out = u.output_tokens;
        } else if (ev.type === 'error') {
          const err = ev.error as { message?: string } | undefined;
          throw new ProviderError('provider_refused', err?.message ?? 'error');
        }
      });
      return { text, usage: finish(usage, opts, text), index };
    }

    const make = (withUsage: boolean) =>
      JSON.stringify({
        model: opts.model,
        messages: [...(opts.system ? [{ role: 'system', content: opts.system }] : []), ...plainTurns(opts.messages)],
        max_tokens: maxTokens,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        stream: true,
        ...(withUsage ? { stream_options: { include_usage: true } } : {}),
      });
    const post = (body: string) =>
      withKeys(ep, (key) =>
        fetch(url(ep.baseUrl, 'chat/completions'), { method: 'POST', headers: headers(ep.wire, key), body, signal }),
      );
    let { res, index } = await post(make(true));
    if (res.status === 400) {
      // Some servers refuse `stream_options`; ask again without it.
      const err = await refusal(res);
      if (!/stream_options/i.test(err.message)) throw err;
      ({ res, index } = await post(make(false)));
    }
    if (!res.ok) throw await refusal(res);
    await readSse(res, (data) => {
      if (data === '[DONE]') return;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(data) as Record<string, unknown>;
      } catch {
        return;
      }
      if (ev.error) {
        const err = ev.error as { message?: string } | string;
        throw new ProviderError('provider_refused', typeof err === 'string' ? err : (err.message ?? 'error'));
      }
      const choice = (ev.choices as { delta?: { content?: unknown } }[] | undefined)?.[0];
      if (typeof choice?.delta?.content === 'string') add(choice.delta.content);
      const u = (ev.usage ?? (ev.x_groq as { usage?: unknown } | undefined)?.usage) as
        | { prompt_tokens?: number; completion_tokens?: number }
        | undefined;
      if (u && typeof u.prompt_tokens === 'number') usage = { in: u.prompt_tokens, out: u.completion_tokens ?? 0 };
    });
    return { text, usage: finish(usage, opts, text), index };
  } catch (e) {
    throw fetchError(e, opts.signal);
  }
}

function finish(u: { in?: number; out?: number }, opts: CompleteOptions, text: string): LlmResult['usage'] {
  if (typeof u.in === 'number' && typeof u.out === 'number') return { in: u.in, out: u.out };
  const prompt = (opts.system ?? '') + opts.messages.map((m) => m.content).join('\n');
  return { in: u.in ?? estimate(prompt), out: u.out ?? estimate(text), estimated: true };
}
