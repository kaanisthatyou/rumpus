import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Channel, Frame, Job, Race, Response, WorkspaceState } from '@lonca/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { OpenSession } from '../src/drivers/types.js';
import { run } from '../src/proc.js';
import { Core } from '../src/server.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const closers: (() => void)[] = [];
afterEach(() => {
  for (const c of closers.splice(0)) c();
});

/** A core with two agents on one repository; the stand-in CLI writes a file in the folder it is started in. */
async function setup() {
  const root = tmp('lonca-race-');
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' }).toString();
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('config', 'core.autocrlf', 'false');
  writeFileSync(join(root, 'README.md'), '# Project\n');
  git('add', '.');
  git('commit', '-qm', 'first');

  const bin = tmp('lonca-bin-');
  writeFileSync(join(bin, 'claude'), '');
  const folders: string[] = [];
  const prompts: string[] = [];
  const open: OpenSession = (opts, emit) => ({
    steering: 'live',
    busy: false,
    send: (prompt) => {
      folders.push(opts.cwd);
      prompts.push(prompt);
      // The first contestant's worktree ends in -1: it is quick; the second takes a little longer.
      const first = opts.cwd.endsWith('-1');
      setTimeout(
        () => {
          writeFileSync(join(opts.cwd, 'result.txt'), first ? 'the quick one\n' : 'the careful one\n');
          emit({ type: 'end', ok: true, final: first ? 'Quick.' : 'Careful.' });
        },
        first ? 0 : 150,
      );
    },
    stop: () => {},
    dispose: () => {},
  });
  const sent: Frame[] = [];
  const core = new Core({
    appDir: tmp('lonca-race-core-'),
    language: 'en',
    env: { PATH: bin },
    platform: 'linux',
    runner: async (file, args, opts) =>
      file === 'git'
        ? run(file, args, opts)
        : {
            code: 0,
            stdout: args[0] === '--version' ? '2.1.0' : JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }),
            stderr: '',
            timedOut: false,
          },
    drivers: { 'claude-code': open },
    launch: (path) => ({ file: path, args: [] }),
  });
  closers.push(() => core.shutdown());
  let listener: (f: unknown) => void = () => {};
  core.attach({ send: (f) => sent.push(f), onFrame: (l) => (listener = l) });
  let id = 0;
  const call = async <T>(method: string, params?: unknown): Promise<T> => {
    const rid = ++id;
    listener({ id: rid, method, params });
    for (let i = 0; i < 4000; i++) {
      const r = sent.find((f) => 'id' in f && f.id === rid && ('result' in f || 'error' in f)) as Response | undefined;
      if (r) {
        if ('error' in r) throw new Error(r.error.code);
        return r.result as T;
      }
      await new Promise((res) => setTimeout(res, 5));
    }
    throw new Error(`no answer: ${method}`);
  };
  const race = (raceId: string) =>
    sent
      .filter((f): f is { event: 'race.changed'; data: Race } => 'event' in f && f.event === 'race.changed')
      .filter((f) => f.data.id === raceId)
      .at(-1)?.data;
  const job = (jobId: string | undefined) =>
    sent
      .filter((f): f is { event: 'job.updated'; data: Job } => 'event' in f && f.event === 'job.updated')
      .filter((f) => f.data.id === jobId)
      .at(-1)?.data;
  const until = async (fn: () => boolean, what: string) => {
    for (let i = 0; i < 1500; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timed out: ${what}`);
  };
  const ana = await call<{ id: string }>('agents.save', {
    kind: 'claude-code',
    name: 'Ana',
    handle: 'ana',
    folder: root,
    mode: 'edit',
  });
  const bora = await call<{ id: string }>('agents.save', {
    kind: 'claude-code',
    name: 'Bora',
    handle: 'bora',
    folder: root,
    mode: 'edit',
  });
  const ws = await call<WorkspaceState>('workspace.get');
  const channelId = (ws.channels.find((c) => c.kind === 'channel') as Channel).id;
  return { root, git, call, race, job, until, ana, bora, channelId, folders, prompts };
}

describe('a race', () => {
  it('runs each agent in a worktree of its own, places them as they finish and commits their work', async () => {
    const { root, git, call, race, job, until, ana, bora, channelId, folders, prompts } = await setup();
    const started = await call<Race>('races.start', {
      channelId,
      task: 'Write the result file',
      agentIds: [ana.id, bora.id],
    });
    expect(started.state).toBe('running');
    expect(started.entries.map((e) => e.branch)).toEqual([
      expect.stringMatching(/^rumpus\/race-[a-z0-9_-]{6}-ana$/),
      expect.stringMatching(/^rumpus\/race-[a-z0-9_-]{6}-bora$/),
    ]);
    // What the page gets says nothing of where things are on this computer.
    expect(JSON.stringify(started)).not.toContain(root.slice(-12));

    await until(() => race(started.id)?.state === 'ready', 'the race to end');
    const ready = race(started.id) as Race;
    expect(ready.entries.map((e) => [e.done, e.place, e.changed])).toEqual([
      [true, 1, true],
      [true, 2, true],
    ]);
    // Each one worked in its own folder, away from the main one, and was told so.
    expect(new Set(folders).size).toBe(2);
    expect(folders.every((f) => f !== root && /race-.*-[12]$/.test(f))).toBe(true);
    expect(prompts[0]).toContain('Write the result file');
    expect(prompts[0]).toContain('2 agents at once');
    expect(existsSync(join(root, 'result.txt'))).toBe(false);
    expect(git('status', '--porcelain').trim()).toBe('');
    // Their work is one commit on their branch, under the agent's name.
    const [a, b] = ready.entries;
    expect(git('show', `${a?.branch}:result.txt`)).toBe('the quick one\n');
    expect(git('show', `${b?.branch}:result.txt`)).toBe('the careful one\n');
    expect(git('log', '-1', '--format=%an|%s', a?.branch ?? '').trim()).toBe('Ana|Write the result file');
    // The jobs are ordinary ones: their cards say what they changed.
    await until(() => job(a?.jobId)?.changes !== undefined && job(b?.jobId)?.changes !== undefined, 'the changes');
    expect(job(b?.jobId)?.changes?.files).toMatchObject([{ path: 'result.txt', status: 'added' }]);

    // Picking the second one: its work is in the main folder, staged and not committed; the worktrees are gone.
    const picked = await call<Race>('races.pick', { id: started.id, agentId: bora.id });
    expect(picked).toMatchObject({ state: 'picked', winner: bora.id });
    expect(picked.entries.every((e) => e.removed)).toBe(true);
    expect(readFileSync(join(root, 'result.txt'), 'utf8')).toBe('the careful one\n');
    expect(git('diff', '--cached', '--name-only').trim()).toBe('result.txt');
    expect(git('log', '--oneline').trim().split('\n')).toHaveLength(1);
    expect(folders.every((f) => !existsSync(f))).toBe(true);
    expect(git('branch', '--list', 'rumpus/race-*').trim().split('\n')).toHaveLength(2);
    await expect(call('races.pick', { id: started.id, agentId: ana.id })).rejects.toThrow('race_state');
    expect((await call<Race[]>('races.list')).map((r) => r.state)).toEqual(['picked']);
  });

  it('leaves the main folder as it was when a pick cannot be applied, and closes without keeping anything', async () => {
    const { root, git, call, race, until, ana, bora, channelId } = await setup();
    const started = await call<Race>('races.start', { channelId, task: 'Again', agentIds: [ana.id, bora.id] });
    await until(() => race(started.id)?.state === 'ready', 'the race to end');

    // Something staged in the main folder: a failed attempt could not be told apart from it.
    writeFileSync(join(root, 'mine.txt'), 'the person is in the middle of something\n');
    git('add', 'mine.txt');
    await expect(call('races.pick', { id: started.id, agentId: ana.id })).rejects.toThrow('race_dirty');
    git('reset', '-q');

    // The person's own file of the same name stands in the way: nothing is changed.
    writeFileSync(join(root, 'result.txt'), 'the person wrote this meanwhile\n');
    await expect(call('races.pick', { id: started.id, agentId: ana.id })).rejects.toThrow('race_conflict');
    expect(readFileSync(join(root, 'result.txt'), 'utf8')).toBe('the person wrote this meanwhile\n');
    expect(readFileSync(join(root, 'mine.txt'), 'utf8')).toContain('in the middle');
    expect(race(started.id)?.state).toBe('ready');

    const closed = await call<Race>('races.close', { id: started.id });
    expect(closed.state).toBe('closed');
    expect(closed.winner).toBeUndefined();
    expect(closed.entries.every((e) => e.removed)).toBe(true);
    expect(git('diff', '--cached', '--name-only').trim()).toBe('');
  });

  it('needs two agents and a repository with a commit', async () => {
    const { call, ana, bora, channelId } = await setup();
    await expect(call('races.start', { channelId, task: 'Alone', agentIds: [ana.id] })).rejects.toThrow('invalid_race');
    await expect(call('races.start', { channelId, task: ' ', agentIds: [ana.id, bora.id] })).rejects.toThrow(
      'invalid_race',
    );
    const plain = tmp('lonca-race-plain-');
    const lone = await call<{ id: string }>('agents.save', {
      kind: 'claude-code',
      name: 'Cem',
      handle: 'cem',
      folder: plain,
      mode: 'edit',
    });
    await expect(call('races.start', { channelId, task: 'Nowhere', agentIds: [lone.id, ana.id] })).rejects.toThrow(
      'not_git',
    );
  });
});
