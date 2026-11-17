import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Channel, Frame, Response, WorkspaceState } from '@lonca/protocol';
import { describe, expect, it } from 'vitest';
import type { AgentSession, DriverEvent, OpenSession, SessionOptions } from '../src/drivers/types.js';
import { Core } from '../src/server.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

function setup() {
  const bin = tmp('lonca-bin-');
  writeFileSync(join(bin, 'claude'), '');
  const sessions: { opts: SessionOptions; emit: (e: DriverEvent) => void }[] = [];
  const open: OpenSession = (opts, emit) => {
    sessions.push({ opts, emit });
    const session: AgentSession = { steering: 'live', busy: false, send: () => {}, stop: () => {}, dispose: () => {} };
    return session;
  };
  const core = new Core({
    appDir: tmp('lonca-rt-'),
    language: 'tr',
    env: { PATH: bin },
    platform: 'linux',
    runner: async (_f, args) => ({
      code: 0,
      stdout: args[0] === '--version' ? '2.1.0' : JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }),
      stderr: '',
      timedOut: false,
    }),
    drivers: { 'claude-code': open },
    launch: (path) => ({ file: path, args: [] }),
  });
  let listener: (f: unknown) => void = () => {};
  const sent: Frame[] = [];
  core.attach({ send: (f) => sent.push(f), onFrame: (l) => (listener = l) });
  let id = 0;
  const call = async <T>(method: string, params?: unknown): Promise<T> => {
    const rid = ++id;
    listener({ id: rid, method, params });
    for (let i = 0; i < 400; i++) {
      const r = sent.find((f) => 'id' in f && f.id === rid && ('result' in f || 'error' in f)) as Response | undefined;
      if (r) {
        if ('error' in r) throw new Error(r.error.code);
        return r.result as T;
      }
      await new Promise((res) => setTimeout(res, 5));
    }
    throw new Error(`no answer: ${method}`);
  };
  return { call, sessions };
}

async function toolOf(sessions: { opts: SessionOptions }[], index: number) {
  for (let i = 0; i < 100 && sessions.length <= index; i++) await new Promise((r) => setTimeout(r, 10));
  const mcp = sessions[index]?.opts.mcp;
  expect(mcp).toBeTruthy();
  return async (name: string, args: Record<string, unknown>): Promise<string> => {
    const res = await fetch(mcp?.url ?? '', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${mcp?.token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const raw = await res.text();
    const json = JSON.parse(
      raw.startsWith('{') ? raw : (raw.split('\n').find((l) => l.startsWith('data:')) ?? '').slice(5),
    );
    return (json.result?.content ?? []).map((c: { text?: string }) => c.text ?? '').join('\n');
  };
}

describe('routine tools', () => {
  it('lets a full-access agent set, change and delete its owner’s routines on their request only', async () => {
    const { call, sessions } = setup();
    const folder = tmp('lonca-proj-');
    await call('agents.save', { kind: 'claude-code', name: 'Nora', handle: 'nora', folder, mode: 'full' });
    await call('agents.save', { kind: 'claude-code', name: 'Okur', handle: 'okur', folder, mode: 'read' });
    const ws = await call<WorkspaceState>('workspace.get');
    const genel = (ws.channels.find((c) => c.kind === 'channel') as Channel).id;

    await call('messages.send', { channelId: genel, text: '@nora her sabah 08:30 özet rutini kur' });
    const tool = await toolOf(sessions, 0);
    expect(await tool('list_routines', {})).toBe('No routines.');
    const saved = await tool('save_routine', { text: '@nora sabah özeti', at: '08:30', days: ['mon', 'tue', 5] });
    expect(saved).toMatch(/^Saved: .+ · on · 08:30 · mon,tue,fri · #/);
    const id = saved.slice('Saved: '.length).split(' · ')[0] ?? '';
    let state = await call<WorkspaceState>('workspace.get');
    expect(state.routines?.[0]).toMatchObject({ id, at: '08:30', days: [1, 2, 5], text: '@nora sabah özeti' });

    // Fields left out stay; a bad time is refused.
    expect(await tool('save_routine', { id, at: '19:30', enabled: false })).toMatch(/off · 19:30 · mon,tue,fri/);
    expect(await tool('save_routine', { id, at: '25:00' })).toMatch(/^Not saved: bad_request/);
    expect(await tool('save_routine', { text: 'x', at: '09:00', channel: 'yok' })).toBe('No channel with this name.');

    // A read-only agent may list but not change.
    await call('messages.send', { channelId: genel, text: '@okur rutinleri sil' });
    const reader = await toolOf(sessions, 1);
    expect(await reader('list_routines', {})).toContain(id);
    expect(await reader('delete_routine', { id })).toBe('Refused: changing routines needs full access.');

    expect(await tool('delete_routine', { id })).toBe('Deleted.');
    state = await call<WorkspaceState>('workspace.get');
    expect(state.routines ?? []).toEqual([]);
  });
});
