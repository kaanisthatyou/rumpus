import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Channel, Frame, Job, Response, WorkspaceState } from '@lonca/protocol';
import { describe, expect, it } from 'vitest';
import type { DriverEvent, OpenSession, SessionOptions } from '../src/drivers/types.js';
import { Core } from '../src/server.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const pause = (ms = 10) => new Promise((r) => setTimeout(r, ms));

// PLAN.md 5.24 (Kaan, 2026-11-19): the box points at the channel's latest card, and a message sent from it goes on in
// that job's conversation instead of opening a new session.
describe('going on from the box', () => {
  it('goes on in the pointed job without naming the agent, and starts fresh without it or for another agent', async () => {
    const bin = tmp('lonca-bin-');
    writeFileSync(join(bin, 'claude'), '');
    const sessions: { opts: SessionOptions; emit: (e: DriverEvent) => void; sent: string[] }[] = [];
    const open: OpenSession = (opts, emit) => {
      const sent: string[] = [];
      sessions.push({ opts, emit, sent });
      return { steering: 'live', busy: false, send: (text) => sent.push(text), stop: () => {}, dispose: () => {} };
    };
    const core = new Core({
      appDir: tmp('lonca-follow-'),
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
        await pause(5);
      }
      throw new Error(`no answer: ${method}`);
    };
    const nth = async (n: number) => {
      for (let i = 0; i < 200 && sessions.length < n; i++) await pause();
      const s = sessions[n - 1];
      if (!s) throw new Error(`no session ${n}`);
      for (let i = 0; i < 200 && s.sent.length === 0; i++) await pause();
      return s;
    };

    const folder = tmp('lonca-proj-');
    for (const [name, handle] of [
      ['Felix', 'felix'],
      ['Nora', 'nora'],
    ])
      await call('agents.save', { kind: 'claude-code', name, handle, folder, mode: 'edit', fresh: true });
    const ws = await call<WorkspaceState>('workspace.get');
    const genel = (ws.channels.find((c) => c.kind === 'channel') as Channel).id;
    const jobs = async () => (await call<{ jobs: Job[] }>('messages.list', { channelId: genel })).jobs;
    const settle = async () => {
      for (let i = 0; i < 100 && (await jobs()).some((j) => j.state === 'running'); i++) await pause();
    };

    await call('messages.send', { channelId: genel, text: '@felix first task' });
    const first = await nth(1);
    first.emit({ type: 'session', id: 'session-1' });
    first.emit({ type: 'end', ok: true, final: 'first done' });
    await settle();
    const firstJob = (await jobs()).at(-1) as Job;

    // Sent from the box pointing at Felix's card, without naming him: his conversation goes on.
    await call('messages.send', { channelId: genel, text: 'and the tests too', follow: firstJob.id });
    const followed = await nth(2);
    expect(followed.opts.resume).toBe('session-1');
    expect(followed.sent[0]).toContain('and the tests too');
    expect(followed.sent[0]).not.toContain('channel_context');
    const followJob = (await jobs()).at(-1) as Job;
    expect(followJob).toMatchObject({ agentId: firstJob.agentId });
    expect(followJob.id).not.toBe(firstJob.id);
    followed.emit({ type: 'session', id: 'session-1' });
    followed.emit({ type: 'end', ok: true, final: 'tests done' });
    await settle();

    // A message naming only another agent is that agent's, in a session of its own.
    await call('messages.send', { channelId: genel, text: '@nora a look please', follow: followJob.id });
    const nora = await nth(3);
    expect(nora.opts.resume).toBeUndefined();
    expect(nora.sent[0]).toContain('a look please');
    expect(sessions).toHaveLength(3);
    nora.emit({ type: 'end', ok: true, final: 'looked' });
    await settle();

    // Closed with ×: the message goes out without `follow` and starts a new session.
    await call('messages.send', { channelId: genel, text: '@felix something new' });
    const fresh = await nth(4);
    expect(fresh.opts.resume).toBeUndefined();
    expect(fresh.sent[0]).toContain('something new');
    fresh.emit({ type: 'end', ok: true, final: 'new done' });
    await settle();
  });
});
