import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Channel, CliAccount, Frame, Job, Quota, Response, WorkspaceState } from '@lonca/protocol';
import { describe, expect, it } from 'vitest';
import type { AgentSession, DriverEvent, OpenSession, SessionOptions } from '../src/drivers/types.js';
import { Core } from '../src/server.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

describe('several logins per CLI', () => {
  it('keeps extra accounts in their own config folders, signs in and runs agents on them', async () => {
    const bin = tmp('lonca-bin-');
    writeFileSync(join(bin, 'claude'), '');
    const sessions: { opts: SessionOptions; emit: (e: DriverEvent) => void }[] = [];
    const open: OpenSession = (opts, emit) => {
      sessions.push({ opts, emit });
      const session: AgentSession = {
        steering: 'live',
        busy: false,
        send: () => {},
        stop: () => {},
        dispose: () => {},
      };
      return session;
    };
    const consoles: { args: readonly string[]; env?: Record<string, string> }[] = [];
    const appDir = tmp('lonca-accounts-');
    const core = new Core({
      appDir,
      language: 'en',
      env: { PATH: bin },
      platform: 'linux',
      // The default login is a subscription; an account folder is signed out until its own login ran.
      runner: async (_f, args, opts) => ({
        code: 0,
        stdout:
          args[0] === '--version'
            ? '2.1.0'
            : JSON.stringify(
                opts?.env?.CLAUDE_CONFIG_DIR
                  ? { loggedIn: false }
                  : { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' },
              ),
        stderr: '',
        timedOut: false,
      }),
      openConsole: (_file, args, _platform, env) => {
        consoles.push({ args, ...(env ? { env } : {}) });
        return true;
      },
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
        const r = sent.find((f) => 'id' in f && f.id === rid && ('result' in f || 'error' in f)) as
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

    expect(await call<CliAccount[]>('accounts.list')).toEqual([]);
    const [second] = await call<CliAccount[]>('accounts.add', { kind: 'claude-code', name: 'Tugba' });
    expect(second).toMatchObject({ kind: 'claude-code', name: 'Tugba', state: 'signed-out' });
    expect(existsSync(second?.folder ?? '')).toBe(true);
    await expect(call('accounts.add', { kind: 'gemini', name: 'x' })).rejects.toThrow('bad_request');

    // The CLI's own login, pointed at the account's folder.
    await call('clis.login', { kind: 'claude-code', account: second?.id });
    expect(consoles[0]).toEqual({ args: ['auth', 'login'], env: { CLAUDE_CONFIG_DIR: second?.folder } });
    await expect(call('clis.login', { kind: 'codex', account: second?.id })).rejects.toThrow();

    // An agent on the account: its CLI runs with the folder, and its quota is the account's.
    const folder = tmp('lonca-proj-');
    await expect(
      call('agents.save', { kind: 'claude-code', name: 'X', handle: 'x', folder, mode: 'read', account: 'nope' }),
    ).rejects.toThrow('invalid_agent');
    await call('agents.save', {
      kind: 'claude-code',
      name: 'Claude Tugba',
      handle: 'tugba',
      folder,
      mode: 'read',
      account: second?.id,
    });
    const ws = await call<WorkspaceState>('workspace.get');
    expect(ws.agents[0]?.account).toBe(second?.id);
    const genel = (ws.channels.find((c) => c.kind === 'channel') as Channel).id;
    await call('messages.send', { channelId: genel, text: '@tugba merhaba' });
    for (let i = 0; i < 100 && sessions.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(sessions[0]?.opts.env).toEqual({ CLAUDE_CONFIG_DIR: second?.folder });
    sessions[0]?.emit({ type: 'quota', quota: { windows: { five_hour: { used: 0.4 } }, at: 1 } });
    const quota = await call<Record<string, Quota>>('quota.get');
    expect(Object.keys(quota)).toEqual([`claude-code:${second?.id}`]);

    // Forgetting the account keeps its folder: the CLI's files are not Rumpus's to delete.
    expect(await call<CliAccount[]>('accounts.remove', { id: second?.id })).toEqual([]);
    expect(existsSync(second?.folder ?? '')).toBe(true);
    core.shutdown();
  });
});

describe('two subscriptions for one crew', () => {
  it('uses a config folder the CLI already signed in to, starts every job fresh, and moves to the spare login at the limit', async () => {
    const bin = tmp('lonca-bin-');
    writeFileSync(join(bin, 'claude'), '');
    const sessions: { opts: SessionOptions; emit: (e: DriverEvent) => void; sent: string[] }[] = [];
    const open: OpenSession = (opts, emit) => {
      const sent: string[] = [];
      sessions.push({ opts, emit, sent });
      return { steering: 'live', busy: false, send: (text) => sent.push(text), stop: () => {}, dispose: () => {} };
    };
    const core = new Core({
      appDir: tmp('lonca-spare-'),
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
        await new Promise((res) => setTimeout(res, 5));
      }
      throw new Error(`no answer: ${method}`);
    };
    const nth = async (n: number) => {
      for (let i = 0; i < 200 && sessions.length < n; i++) await new Promise((r) => setTimeout(r, 10));
      const s = sessions[n - 1];
      if (!s) throw new Error(`no session ${n}`);
      for (let i = 0; i < 200 && s.sent.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
      return s;
    };

    // A second login's folder, signed in from a shell alias long before (`claude2` → `~/.claude2`).
    const claude2 = tmp('lonca-claude2-');
    const [felix] = await call<CliAccount[]>('accounts.add', { kind: 'claude-code', name: 'Felix', folder: claude2 });
    expect(felix?.folder).toBe(claude2);
    await expect(call('accounts.add', { kind: 'claude-code', name: 'Again', folder: claude2 })).rejects.toThrow(
      'account_taken',
    );
    await expect(call('accounts.add', { kind: 'claude-code', name: 'X', folder: 'relative' })).rejects.toThrow(
      'folder_missing',
    );
    await expect(
      call('accounts.add', { kind: 'claude-code', name: 'X', folder: join(claude2, 'missing') }),
    ).rejects.toThrow('folder_missing');

    // Nora runs on the default login, with Felix's as her spare, and starts every job fresh.
    const folder = tmp('lonca-proj-');
    const nora = await call<{ spare?: string; fresh?: boolean }>('agents.save', {
      kind: 'claude-code',
      name: 'Nora',
      handle: 'nora',
      folder,
      mode: 'edit',
      spare: felix?.id,
      fresh: true,
    });
    expect(nora).toMatchObject({ spare: felix?.id, fresh: true });
    const ws = await call<WorkspaceState>('workspace.get');
    const genel = (ws.channels.find((c) => c.kind === 'channel') as Channel).id;
    const lastJob = async () => (await call<{ jobs: Job[] }>('messages.list', { channelId: genel })).jobs.at(-1) as Job;

    await call('messages.send', { channelId: genel, text: '@nora first task' });
    const first = await nth(1);
    expect(first.opts.env).toBeUndefined();
    first.emit({ type: 'session', id: 'session-1' });
    first.emit({ type: 'end', ok: true, final: 'first done' });

    // The next job does not resume the first one's conversation; it reads the channel instead.
    await call('messages.send', { channelId: genel, text: '@nora second task' });
    const second = await nth(2);
    expect(second.opts.resume).toBeUndefined();
    expect(second.sent[0]).toContain('first done');
    expect(second.sent[0]).toContain('second task');

    // The default login hits its limit mid-job: the same job goes on with Felix's login.
    second.emit({ type: 'quota', quota: { windows: { five_hour: { used: 1 } }, status: 'rejected', at: Date.now() } });
    second.emit({ type: 'end', ok: false, error: "You've hit your limit · resets 5am" });
    const third = await nth(3);
    expect(third.opts.env).toEqual({ CLAUDE_CONFIG_DIR: claude2 });
    expect(third.sent[0]).toContain('second task');
    expect(third.sent[0]).toContain('usage limit');
    const moved = await lastJob();
    expect(moved.state).toBe('running');
    expect(moved.steps.some((s) => s.kind === 'notice' && s.label === 'spare')).toBe(true);
    third.emit({ type: 'end', ok: true, final: 'second done' });
    for (let i = 0; i < 100 && (await lastJob()).state !== 'done'; i++) await new Promise((r) => setTimeout(r, 10));
    expect((await lastJob()).id).toBe(moved.id);
    expect((await lastJob()).state).toBe('done');

    // While the default login is out, new jobs start on the spare one straight away.
    await call('messages.send', { channelId: genel, text: '@nora third task' });
    const fourth = await nth(4);
    expect(fourth.opts.env).toEqual({ CLAUDE_CONFIG_DIR: claude2 });
    core.shutdown();
  });
});
