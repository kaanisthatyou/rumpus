import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Channel, Frame, Message, Response, Routine, WorkspaceState } from '@lonca/protocol';
import { describe, expect, it } from 'vitest';
import type { AgentSession, OpenSession } from '../src/drivers/types.js';
import { CATCH_UP_MS, dueOn, nextRun, Routines } from '../src/routines.js';
import { Core } from '../src/server.js';
import { WorkspaceStore } from '../src/store.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
/** A local moment on a known day: 2026-11-10 is a Tuesday (day 2). */
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute, 0, 0).getTime();

describe('when a routine is due', () => {
  it('is due at its time on its days', () => {
    expect(dueOn({ at: '09:30', days: [] }, at(10, 8))).toBe(at(10, 9, 30));
    expect(dueOn({ at: '09:30', days: [2] }, at(10, 23))).toBe(at(10, 9, 30));
    expect(dueOn({ at: '09:30', days: [1, 3] }, at(10, 8))).toBeUndefined();
  });

  it('finds the next time after now', () => {
    expect(nextRun({ at: '09:30', days: [] }, at(10, 8))).toBe(at(10, 9, 30));
    expect(nextRun({ at: '09:30', days: [] }, at(10, 10))).toBe(at(11, 9, 30));
    // Mondays only, asked on a Tuesday: next week's Monday.
    expect(nextRun({ at: '09:30', days: [1] }, at(10, 10))).toBe(at(16, 9, 30));
  });
});

describe('Routines', () => {
  const routine = (over: Partial<Routine> = {}): Routine => ({
    id: 'r1',
    channelId: 'c1',
    text: '@test testleri çalıştır',
    at: '09:00',
    days: [],
    enabled: true,
    owner: 'me',
    created: at(9, 12),
    ...over,
  });

  function setup(...list: Routine[]) {
    const store = new WorkspaceStore(join(tmp('lonca-routine-'), 'lonca.db'), 'me');
    for (const r of list) store.commit({ type: 'routine.saved', data: r });
    const posted: string[] = [];
    const routines = new Routines({
      store,
      deviceId: 'me',
      post: (r) => {
        posted.push(r.id);
        return true;
      },
    });
    return { store, routines, posted };
  }

  it('posts once when the time comes, and again the next day', () => {
    const { routines, posted } = setup(routine());
    routines.tick(at(10, 8, 59));
    expect(posted).toEqual([]);
    routines.tick(at(10, 9, 0));
    routines.tick(at(10, 9, 1));
    routines.tick(at(10, 15));
    expect(posted).toEqual(['r1']);
    routines.tick(at(11, 9, 0));
    expect(posted).toEqual(['r1', 'r1']);
  });

  it('catches up within an hour, and lets an older miss go', () => {
    const late = setup(routine());
    late.routines.tick(at(10, 9, 40));
    expect(late.posted).toEqual(['r1']);
    const missed = setup(routine());
    missed.routines.tick(at(10, 9, 0) + CATCH_UP_MS + 60_000);
    expect(missed.posted).toEqual([]);
  });

  it("leaves alone what is off, another computer's, not due today, or made after today's time", () => {
    const { routines, posted } = setup(
      routine({ id: 'off', enabled: false }),
      routine({ id: 'theirs', owner: 'other' }),
      routine({ id: 'monday', days: [1] }),
      routine({ id: 'new', created: at(10, 9, 5) }),
    );
    routines.tick(at(10, 9, 10));
    expect(posted).toEqual([]);
  });
});

describe('routines in a workspace', () => {
  it('saves, runs now as the person (which starts the agent), and deletes', async () => {
    const bin = tmp('lonca-bin-');
    writeFileSync(join(bin, 'claude'), '');
    const sent: string[] = [];
    const open: OpenSession = () => {
      const session: AgentSession = {
        steering: 'live',
        busy: false,
        send: (t) => sent.push(t),
        stop: () => {},
        dispose: () => {},
      };
      return session;
    };
    const core = new Core({
      appDir: tmp('lonca-routines-'),
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
    const frames: Frame[] = [];
    core.attach({ send: (f) => frames.push(f), onFrame: (l) => (listener = l) });
    let id = 0;
    const call = async <T>(method: string, params?: unknown): Promise<T> => {
      const rid = ++id;
      listener({ id: rid, method, params });
      for (let i = 0; i < 1000; i++) {
        const r = frames.find((f) => 'id' in f && f.id === rid && ('result' in f || 'error' in f)) as
          | Response
          | undefined;
        if (r) {
          if ('error' in r) throw new Error(r.error.code);
          return r.result as T;
        }
        await new Promise((res) => setTimeout(res, 5));
      }
      throw new Error(`no answer: ${method}`);
    };
    await call('agents.save', {
      kind: 'claude-code',
      name: 'Test',
      handle: 'test',
      folder: tmp('lonca-a-'),
      mode: 'read',
    });
    const state = () => call<WorkspaceState>('workspace.get');
    const genel = ((await state()).channels.find((c) => c.kind === 'channel') as Channel).id;

    await expect(call('routines.save', { channelId: genel, text: 'x', at: '25:00' })).rejects.toThrow('bad_request');
    await expect(call('routines.save', { channelId: 'yok', text: 'x', at: '09:00' })).rejects.toThrow('not_found');
    const made = await call<Routine>('routines.save', {
      channelId: genel,
      text: '@test testleri çalıştır',
      at: '09:00',
      days: [5, 1, 1],
    });
    expect(made).toMatchObject({ days: [1, 5], enabled: true, text: '@test testleri çalıştır' });
    const shown = (await state()).routines?.[0];
    expect(shown?.next).toBeGreaterThan(Date.now());
    expect(shown?.last).toBeUndefined();

    // Run now: the message is the person's, marked as a routine's, and the agent takes it as a request.
    await call('routines.run', { id: made.id });
    const page = await call<{ messages: Message[] }>('messages.list', { channelId: genel });
    expect(page.messages.at(-1)).toMatchObject({
      author: { kind: 'person' },
      text: '@test testleri çalıştır',
      routine: made.id,
    });
    for (let i = 0; i < 200 && sent.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(sent[0]).toContain('@test testleri çalıştır');
    expect((await state()).routines?.[0]?.last).toBeGreaterThan(made.created);

    const off = await call<Routine>('routines.save', { ...made, enabled: false });
    expect(off.enabled).toBe(false);
    expect((await state()).routines?.[0]?.next).toBeUndefined();
    await call('routines.delete', { id: made.id });
    expect((await state()).routines).toEqual([]);
    await expect(call('routines.run', { id: made.id })).rejects.toThrow('not_found');
  });
});
