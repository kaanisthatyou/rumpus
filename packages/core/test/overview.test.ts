import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Channel, type Frame, handleOf, type Overview, type Response, type WorkspaceState } from '@lonca/protocol';
import { describe, expect, it } from 'vitest';
import type { AgentSession, DriverEvent, OpenSession } from '../src/drivers/types.js';
import { Core } from '../src/server.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

function setup() {
  const bin = tmp('lonca-bin-');
  writeFileSync(join(bin, 'claude'), '');
  const sessions: { emit: (e: DriverEvent) => void }[] = [];
  const open: OpenSession = (_opts, emit) => {
    sessions.push({ emit });
    const session: AgentSession = { steering: 'live', busy: false, send: () => {}, stop: () => {}, dispose: () => {} };
    return session;
  };
  const core = new Core({
    appDir: tmp('lonca-overview-'),
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
  const until = async <T>(
    fn: () => T | undefined | false | Promise<T | undefined | false>,
    what: string,
  ): Promise<T> => {
    for (let i = 0; i < 300; i++) {
      const v = await fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timed out: ${what}`);
  };
  return { call, sessions, until };
}

describe('handleOf', () => {
  it('makes what is typed after @ from a name', () => {
    expect(handleOf('Doğrucu Davut')).toBe('dogrucu-davut');
    expect(handleOf('  IŞIK İnce  ')).toBe('isik-ince');
    expect(handleOf('Kaan')).toBe('kaan');
    expect(handleOf('!!!')).toBe('');
  });
});

describe('unread messages and the overview', () => {
  it('counts what arrived since the channel was last open, and mentions of the person', async () => {
    const { call, sessions, until } = setup();
    await call('settings.update', { profile: { name: 'Kaan' } });
    await call('agents.save', {
      kind: 'claude-code',
      name: 'Claude',
      handle: 'claude',
      folder: tmp('lonca-a-'),
      mode: 'read',
    });
    const state = () => call<WorkspaceState>('workspace.get');
    const genel = ((await state()).channels.find((c) => c.kind === 'channel') as Channel).id;

    // The person's own message leaves nothing unread; the agent's answer does, and it mentions them.
    await call('messages.send', { channelId: genel, text: '@claude README ne diyor?' });
    expect((await state()).unread).toEqual({});
    const s = await until(() => sessions[0], 'the job starts');
    s.emit({ type: 'usage', usage: { in: 1200, cached: 8000, out: 300 } });
    s.emit({ type: 'end', ok: true, final: '@kaan README kısa bir tanıtım.', cost: 0.02 });
    await until(async () => (await state()).unread?.[genel], 'the answer counts as unread');
    expect((await state()).unread?.[genel]).toEqual({ count: 1, mention: true });

    // Opening the channel reads it.
    await call('channels.read', { channelId: genel });
    expect((await state()).unread).toEqual({});
    await expect(call('channels.read', { channelId: 'yok' })).rejects.toThrow('not_found');

    // The overview: today's numbers, seven days, the finished job with its request and channel.
    const o = await call<Overview>('overview.get');
    expect(o.today).toMatchObject({ messages: 2, jobs: 1, failed: 0, cost: 0.02 });
    expect(o.today.usage).toEqual({ in: 1200, cached: 8000, out: 300 });
    expect(o.days).toHaveLength(7);
    expect(o.days.at(-1)).toMatchObject({ jobs: 1, tokens: 1500 });
    expect(o.days.slice(0, 6).every((d) => d.jobs === 0)).toBe(true);
    expect(o.recent).toHaveLength(1);
    expect(o.recent[0]).toMatchObject({
      request: '@claude README ne diyor?',
      channel: 'genel',
      job: { state: 'done' },
    });
  });
});
