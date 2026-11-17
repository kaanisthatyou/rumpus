// Which models a CLI offers, as the CLI itself lists them, without spending tokens: Claude Code answers the
// stream-json `initialize` control request with its model menu (checked with 2.1.325), and Codex lists its models
// over `codex app-server` with `model/list` (checked with codex-cli 0.169.0, which answers without a login).
// Rumpus only starts the CLI, asks, and stops it; nothing is sent to a model.
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import type { CliKind, CliModel, CliModels } from '@lonca/protocol';
import { LineReader } from './drivers/types.js';
import { killTree, type Launch } from './proc.js';

/** How long a CLI may take to list its models (Claude Code reads its settings and plugins first). */
export const MODELS_TIMEOUT_MS = 30_000;
/** Pages of `model/list` read at most. */
const MAX_PAGES = 5;

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Claude Code's `initialize` answer: `models: [{ value, resolvedModel, displayName, description }]`. */
export function parseClaudeModels(response: unknown): CliModels {
  const list = (response as { models?: unknown } | undefined)?.models;
  if (!Array.isArray(list)) return { models: [] };
  const models: CliModel[] = [];
  let fallback: { resolved?: string; description?: string } | undefined;
  for (const m of list as Record<string, unknown>[]) {
    const id = text(m?.value);
    if (!id) continue;
    // "default" is the CLI's own pick: no flag at all. Its name is the model it resolves to.
    if (id === 'default') {
      fallback = {
        ...(text(m.resolvedModel) ? { resolved: text(m.resolvedModel) } : {}),
        ...(text(m.description) ? { description: text(m.description) } : {}),
      };
      continue;
    }
    if (models.some((x) => x.id === id)) continue;
    const description = text(m.description);
    models.push({ id, name: text(m.displayName) ?? id, ...(description ? { description } : {}) });
  }
  const resolved = fallback?.resolved
    ? list.find((m: Record<string, unknown>) => m?.value !== 'default' && m?.resolvedModel === fallback?.resolved)
    : undefined;
  const defaultName = text((resolved as Record<string, unknown> | undefined)?.displayName) ?? fallback?.description;
  return { models, ...(defaultName ? { defaultName } : {}) };
}

/** One page of Codex's `model/list`: `{ data: [{ model, displayName, description, hidden, isDefault }] }`. */
export function parseCodexModels(result: unknown): CliModels & { next?: string } {
  const r = (result ?? {}) as { data?: unknown; nextCursor?: unknown };
  const models: CliModel[] = [];
  let defaultName: string | undefined;
  for (const m of Array.isArray(r.data) ? (r.data as Record<string, unknown>[]) : []) {
    const id = text(m?.model) ?? text(m?.id);
    if (!id || m.hidden === true) continue;
    const name = text(m.displayName) ?? id;
    const description = text(m.description);
    models.push({ id, name, ...(description ? { description } : {}) });
    if (m.isDefault === true) defaultName = name;
  }
  const next = text(r.nextCursor);
  return { models, ...(defaultName ? { defaultName } : {}), ...(next ? { next } : {}) };
}

/**
 * Starts the CLI, asks for its models and stops it. Never throws: a CLI that cannot say gives an empty list and the
 * form falls back to typing a name.
 */
export function listModels(
  kind: CliKind,
  launch: Launch,
  env: Record<string, string> | undefined,
  timeoutMs = MODELS_TIMEOUT_MS,
): Promise<CliModels> {
  if (kind !== 'claude-code' && kind !== 'codex') return Promise.resolve({ models: [] });
  return new Promise((resolve) => {
    const procEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
    delete procEnv.ELECTRON_RUN_AS_NODE;
    const args =
      kind === 'claude-code'
        ? ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--strict-mcp-config']
        : ['app-server'];
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(launch.file, [...launch.args, ...args], {
        cwd: homedir(),
        env: { ...procEnv, ...launch.env },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      resolve({ models: [] });
      return;
    }
    let settled = false;
    const done = (result: CliModels) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin?.end();
      killTree(child.pid);
      resolve(result);
    };
    const timer = setTimeout(() => done({ models: [] }), timeoutMs);
    const send = (o: unknown) => {
      if (!child.stdin?.writable) return;
      child.stdin.write(`${JSON.stringify(o)}\n`);
    };
    child.on('error', () => done({ models: [] }));
    child.on('close', () => done({ models: [] }));
    child.stdin?.on('error', () => {});

    const found: CliModel[] = [];
    let defaultName: string | undefined;
    let page = 0;
    const reader = new LineReader((line) => {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }
      if (kind === 'claude-code') {
        const res = ev.response as Record<string, unknown> | undefined;
        if (ev.type === 'control_response' && res?.request_id === 'models') {
          done(res.subtype === 'success' ? parseClaudeModels(res.response) : { models: [] });
        }
        return;
      }
      if (ev.id === 'init') {
        if (ev.error) return done({ models: [] });
        send({ jsonrpc: '2.0', method: 'initialized' });
        send({ jsonrpc: '2.0', id: 'models-0', method: 'model/list', params: {} });
      } else if (typeof ev.id === 'string' && ev.id.startsWith('models-')) {
        if (ev.error) return done({ models: found, ...(defaultName ? { defaultName } : {}) });
        const part = parseCodexModels(ev.result);
        for (const m of part.models) if (!found.some((x) => x.id === m.id)) found.push(m);
        defaultName ??= part.defaultName;
        page++;
        if (part.next && page < MAX_PAGES) {
          send({ jsonrpc: '2.0', id: `models-${page}`, method: 'model/list', params: { cursor: part.next } });
        } else {
          done({ models: found, ...(defaultName ? { defaultName } : {}) });
        }
      }
    });
    child.stdout?.on('data', (chunk: Buffer) => reader.push(chunk));

    if (kind === 'claude-code') {
      send({ type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } });
    } else {
      send({
        jsonrpc: '2.0',
        id: 'init',
        method: 'initialize',
        params: { clientInfo: { name: 'rumpus', version: '0' } },
      });
    }
  });
}
