import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Channel, Frame, Job, Message, Response, WorkspaceState } from '@lonca/protocol';
import { describe, expect, it } from 'vitest';
import type { AgentSession, DriverEvent, OpenSession, SessionOptions } from '../src/drivers/types.js';
import { Core } from '../src/server.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

function setup() {
  const bin = tmp('lonca-bin-');
  writeFileSync(join(bin, 'claude'), '');
  const sessions: { opts: SessionOptions; emit: (e: DriverEvent) => void; sent: string[]; disposed: boolean }[] = [];
  const open: OpenSession = (opts, emit) => {
    const s = { opts, emit, sent: [] as string[], disposed: false };
    sessions.push(s);
    const session: AgentSession = {
      steering: 'live',
      busy: false,
      send: (t) => s.sent.push(t),
      stop: () => {},
      dispose: () => {
        s.disposed = true;
      },
    };
    return session;
  };
  const core = new Core({
    appDir: tmp('lonca-handover-'),
    language: 'en',
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
    for (let i = 0; i < 1000; i++) {
      const r = sent.find((f) => 'id' in f && f.id === rid && ('result' in f || 'error' in f)) as Response | undefined;
      if (r) {
        if ('error' in r) throw new Error(r.error.code);
        return r.result as T;
      }
      await new Promise((res) => setTimeout(res, 5));
    }
    throw new Error(`no answer: ${method}`);
  };
  const tool = async (mcp: SessionOptions['mcp'], name: string, args: Record<string, unknown>) => {
    const r = await fetch(mcp?.url ?? '', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${mcp?.token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = (await r.json()) as { result: { content: { text: string }[] } };
    return body.result.content[0]?.text ?? '';
  };
  const until = async <T>(fn: () => T | undefined | false, what: string): Promise<T> => {
    for (let i = 0; i < 300; i++) {
      const v = fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timed out: ${what}`);
  };
  return { core, call, sessions, tool, until };
}

describe('handing over parts of a job', () => {
  it('runs a part as the same request, one step deep, and brings its answer back', async () => {
    const { call, sessions, tool, until } = setup();
    await call('agents.save', {
      kind: 'claude-code',
      name: 'Ana',
      handle: 'ana',
      folder: tmp('lonca-a-'),
      mode: 'edit',
    });
    await call('agents.save', {
      kind: 'claude-code',
      name: 'Yardımcı',
      handle: 'yardimci',
      folder: tmp('lonca-b-'),
      mode: 'read',
    });
    const ws = await call<WorkspaceState>('workspace.get');
    const genel = (ws.channels.find((c) => c.kind === 'channel') as Channel).id;
    const request = await call<Message>('messages.send', { channelId: genel, text: '@ana formu ve testleri yap' });
    const main = await until(() => sessions[0], 'ana starts');
    expect(main.opts.systemPrompt).toContain('hand_over');

    const handed = await tool(main.opts.mcp, 'hand_over', {
      agent: '@yardimci',
      task: 'Login formu için testleri yaz.',
    });
    expect(handed).toMatch(/^Handed over to @yardimci as part /);
    const partId = /part (\S+?)\./.exec(handed)?.[1] ?? '';
    const helper = await until(() => sessions[1], 'yardimci starts');
    expect(helper.sent.join('\n')).toContain('Login formu için testleri yaz.');
    expect(helper.opts.mode).toBe('read');
    const page = await call<{ messages: Message[]; jobs: Job[] }>('messages.list', { channelId: genel });
    const part = page.messages.find((m) => m.id === partId);
    expect(part).toMatchObject({
      author: { kind: 'agent', name: 'Ana' },
      handover: { requestId: request.id },
      text: '@yardimci Login formu için testleri yaz.',
    });

    // A part cannot be handed on, and an agent cannot hand to itself or to nobody.
    expect(await tool(helper.opts.mcp, 'hand_over', { agent: 'ana', task: 'x' })).toMatch(/^Refused/);
    expect(await tool(main.opts.mcp, 'hand_over', { agent: 'ana', task: 'x' })).toMatch(/^No agent @ana/);
    expect(await tool(main.opts.mcp, 'part_status', { id: partId })).toMatch(/working on it/);
    expect(await tool(helper.opts.mcp, 'part_status', { id: partId })).toMatch(/^No part/);

    // The part ends: its answer comes back to the agent that handed it, and its session closes.
    setTimeout(() => helper.emit({ type: 'end', ok: true, final: 'Üç test yazıldı, hepsi geçiyor.' }), 50);
    const status = await tool(main.opts.mcp, 'part_status', { id: partId, wait_seconds: 5 });
    expect(status).toContain('@yardimci finished');
    expect(status).toContain('Üç test yazıldı, hepsi geçiyor.');
    await until(() => helper.disposed, 'part session closed');
    expect(main.disposed).toBe(false);
    main.emit({ type: 'end', ok: true, final: 'Form hazır; testleri @yardimci yazdı.' });

    // The handing agent's answer mentions @yardimci, but only people (and parts) start work.
    await new Promise((r) => setTimeout(r, 100));
    expect(sessions).toHaveLength(2);
  });
});
