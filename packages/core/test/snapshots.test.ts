import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Channel, Frame, Job, JobFileChange, Response, WorkspaceState } from '@lonca/protocol';
import { describe, expect, it } from 'vitest';
import type { OpenSession } from '../src/drivers/types.js';
import { run } from '../src/proc.js';
import { Core } from '../src/server.js';
import { Snapshots } from '../src/snapshots.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

/** A repository with two committed files, one staged change and one new file git does not know yet. */
function repo() {
  const root = tmp('lonca-snap-');
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' }).toString();
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('config', 'core.autocrlf', 'false');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.txt'), 'one\ntwo\nthree\n');
  writeFileSync(join(root, 'src', 'b.txt'), 'kept\n');
  writeFileSync(join(root, '.gitignore'), 'ignored/\n');
  git('add', '.');
  git('commit', '-qm', 'first');
  // The person's own work in progress: staged, unstaged and unknown to git.
  writeFileSync(join(root, 'src', 'b.txt'), 'kept\nstaged by the person\n');
  git('add', 'src/b.txt');
  writeFileSync(join(root, 'notes.md'), 'a note the person has not added\n');
  const snapshots = new Snapshots(run, join(tmp('lonca-snap-data-'), 'jobs'));
  const state = () => `${git('status', '--porcelain')}|${git('diff', '--cached', '--name-only')}`;
  const refs = () => git('for-each-ref', '--format=%(refname)', 'refs/rumpus').trim().split('\n').filter(Boolean);
  return { root, git, snapshots, state, refs };
}

const paths = (files: JobFileChange[] | undefined) => (files ?? []).map((f) => `${f.status} ${f.path}`).sort();

describe('what a job changed', () => {
  it('finds changed, new and deleted files without touching the person’s index or files', async () => {
    const { root, snapshots, state, refs } = repo();
    const before = state();
    await snapshots.before('job1', root);
    expect(state()).toBe(before);

    // The job: edits a tracked file, edits the person's unknown file, adds one, deletes one, writes into an ignored folder.
    writeFileSync(join(root, 'src', 'a.txt'), 'one\nTWO\nthree\nfour\n');
    writeFileSync(join(root, 'notes.md'), 'a note the person has not added\nand a line by the agent\n');
    writeFileSync(join(root, 'src', 'new.txt'), 'made by the agent\n');
    rmSync(join(root, 'src', 'b.txt'));
    mkdirSync(join(root, 'ignored'));
    writeFileSync(join(root, 'ignored', 'cache.bin'), 'x');
    const during = state();

    const changes = await snapshots.after('job1');
    expect(state()).toBe(during);
    expect(paths(changes?.files)).toEqual([
      'added src/new.txt',
      'deleted src/b.txt',
      'modified notes.md',
      'modified src/a.txt',
    ]);
    expect(changes?.files.find((f) => f.path === 'src/a.txt')).toMatchObject({ added: 2, removed: 1 });
    expect(refs()).toEqual(['refs/rumpus/jobs/job1/after', 'refs/rumpus/jobs/job1/before']);

    const { patch } = await snapshots.diff('job1', 'src/a.txt');
    expect(patch.startsWith('@@')).toBe(true);
    expect(patch).toContain('-two\n+TWO\n');
    expect(patch).toContain('+four');
  });

  it('takes files back, one or all, and leaves a file that was worked on since', async () => {
    const { root, snapshots, state } = repo();
    const before = state();
    await snapshots.before('job2', root);
    writeFileSync(join(root, 'src', 'a.txt'), 'changed by the agent\n');
    writeFileSync(join(root, 'src', 'new.txt'), 'made by the agent\n');
    rmSync(join(root, 'src', 'b.txt'));
    writeFileSync(join(root, 'notes.md'), 'rewritten by the agent\n');
    const changes = await snapshots.after('job2');
    const files = changes?.files ?? [];
    const one = (path: string) => files.filter((f) => f.path === path);

    expect(await snapshots.undo('job2', one('src/a.txt'))).toEqual({ undone: ['src/a.txt'], skipped: [] });
    expect(readFileSync(join(root, 'src', 'a.txt'), 'utf8')).toBe('one\ntwo\nthree\n');

    // The person edits a file after the job: it is not taken back.
    writeFileSync(join(root, 'notes.md'), 'rewritten by the agent\nand then by the person\n');
    const rest = await snapshots.undo(
      'job2',
      files.filter((f) => f.path !== 'src/a.txt'),
    );
    expect(rest.undone.sort()).toEqual(['src/b.txt', 'src/new.txt']);
    expect(rest.skipped).toEqual(['notes.md']);
    expect(existsSync(join(root, 'src', 'new.txt'))).toBe(false);
    // The deleted file is back as it was in the folder (with the person's staged line), and the index is as before.
    expect(readFileSync(join(root, 'src', 'b.txt'), 'utf8')).toBe('kept\nstaged by the person\n');
    expect(readFileSync(join(root, 'notes.md'), 'utf8')).toContain('and then by the person');
    expect(state().replace(' M notes.md', '?? notes.md')).toBe(before);
  });

  it('keeps to the agent’s folder inside a larger repository', async () => {
    const { root, snapshots } = repo();
    mkdirSync(join(root, 'docs'));
    await snapshots.before('job3', join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.txt'), 'changed\n');
    writeFileSync(join(root, 'docs', 'outside.md'), 'someone else wrote this meanwhile\n');
    const changes = await snapshots.after('job3');
    expect(paths(changes?.files)).toEqual(['modified src/a.txt']);
  });

  it('keeps nothing when a job changed nothing, and does nothing outside a repository', async () => {
    const { root, snapshots, refs } = repo();
    await snapshots.before('job4', root);
    expect(await snapshots.after('job4')).toBeUndefined();
    expect(refs()).toEqual([]);
    await expect(snapshots.diff('job4', 'src/a.txt')).rejects.toMatchObject({ code: 'no_snapshot' });

    const plain = tmp('lonca-snap-plain-');
    writeFileSync(join(plain, 'a.txt'), 'x');
    await snapshots.before('job5', plain);
    writeFileSync(join(plain, 'a.txt'), 'y');
    expect(await snapshots.after('job5')).toBeUndefined();
    expect(await snapshots.after('never-started')).toBeUndefined();
  });

  it('gives a file back with the line endings it had, also where git converts them', async () => {
    const { root, git, snapshots } = repo();
    git('config', 'core.autocrlf', 'true');
    writeFileSync(join(root, 'unix.txt'), 'a\nb\n');
    writeFileSync(join(root, 'dos.txt'), 'a\r\nb\r\n');
    await snapshots.before('job7', root);
    writeFileSync(join(root, 'unix.txt'), 'a\nb\nc\n');
    writeFileSync(join(root, 'dos.txt'), 'a\r\nb\r\nc\r\n');
    const changes = await snapshots.after('job7');
    expect(changes?.files.map((f) => [f.path, f.added, f.removed])).toEqual([
      ['dos.txt', 1, 0],
      ['unix.txt', 1, 0],
    ]);
    expect((await snapshots.undo('job7', changes?.files ?? [])).undone.sort()).toEqual(['dos.txt', 'unix.txt']);
    expect(readFileSync(join(root, 'unix.txt'), 'utf8')).toBe('a\nb\n');
    expect(readFileSync(join(root, 'dos.txt'), 'utf8')).toBe('a\r\nb\r\n');
  });

  it('works in a repository without a commit yet', async () => {
    const root = tmp('lonca-snap-new-');
    execFileSync('git', ['-C', root, 'init', '-q']);
    writeFileSync(join(root, 'a.txt'), 'first\n');
    const snapshots = new Snapshots(run, join(tmp('lonca-snap-data-'), 'jobs'));
    await snapshots.before('job6', root);
    writeFileSync(join(root, 'a.txt'), 'first\nsecond\n');
    const changes = await snapshots.after('job6');
    expect(paths(changes?.files)).toEqual(['modified a.txt']);
    expect(await snapshots.undo('job6', changes?.files ?? [])).toEqual({ undone: ['a.txt'], skipped: [] });
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('first\n');
  });
});

// ---------------------------------------------------------------- through the core

describe('a job’s changes through the core', () => {
  it('puts what the agent changed on the job, shows a file’s diff and takes it back', async () => {
    const { root } = repo();
    const bin = tmp('lonca-bin-');
    writeFileSync(join(bin, 'claude'), '');
    const sent: Frame[] = [];
    const open: OpenSession = (_opts, emit) => ({
      steering: 'live',
      busy: false,
      // The agent's turn: it edits a file and adds one, then ends. The snapshot was taken before this is called.
      send: () => {
        writeFileSync(join(root, 'src', 'a.txt'), 'one\ntwo\nthree\nfour by the agent\n');
        writeFileSync(join(root, 'src', 'made.txt'), 'new\n');
        emit({ type: 'end', ok: true, final: 'Bitti.' });
      },
      stop: () => {},
      dispose: () => {},
    });
    const core = new Core({
      appDir: tmp('lonca-snap-core-'),
      language: 'en',
      env: { PATH: bin },
      platform: 'linux',
      // git is the real one; the CLI's own commands are answered here.
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
    let listener: (f: unknown) => void = () => {};
    core.attach({ send: (f) => sent.push(f), onFrame: (l) => (listener = l) });
    let id = 0;
    const call = async <T>(method: string, params?: unknown): Promise<T> => {
      const rid = ++id;
      listener({ id: rid, method, params });
      for (let i = 0; i < 2000; i++) {
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
    const lastJob = () =>
      sent.filter((f): f is { event: 'job.updated'; data: Job } => 'event' in f && f.event === 'job.updated').at(-1)
        ?.data;
    const until = async (fn: () => boolean, what: string) => {
      for (let i = 0; i < 1000; i++) {
        if (fn()) return;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`timed out: ${what}`);
    };
    try {
      await call('agents.save', { kind: 'claude-code', name: 'Ana', handle: 'ana', folder: root, mode: 'edit' });
      const ws = await call<WorkspaceState>('workspace.get');
      const genel = (ws.channels.find((c) => c.kind === 'channel') as Channel).id;
      await call('messages.send', { channelId: genel, text: '@ana dosyayı düzenle' });
      await until(() => lastJob()?.changes !== undefined, 'the changes');
      const job = lastJob() as Job;
      expect(job.state).toBe('done');
      expect(paths(job.changes?.files)).toEqual(['added src/made.txt', 'modified src/a.txt']);

      const { patch } = await call<{ patch: string }>('jobs.diff', { id: job.id, path: 'src/a.txt' });
      expect(patch).toContain('+four by the agent');
      await expect(call('jobs.diff', { id: job.id, path: '../outside' })).rejects.toThrow('no_snapshot');

      expect(await call('jobs.undo', { id: job.id, paths: ['src/a.txt'] })).toEqual({
        undone: ['src/a.txt'],
        skipped: [],
      });
      expect(readFileSync(join(root, 'src', 'a.txt'), 'utf8')).toBe('one\ntwo\nthree\n');
      await until(() => lastJob()?.changes?.files.some((f) => f.undone) === true, 'the undone mark');
      expect(await call('jobs.undo', { id: job.id })).toEqual({ undone: ['src/made.txt'], skipped: [] });
      expect(existsSync(join(root, 'src', 'made.txt'))).toBe(false);
      await until(() => lastJob()?.changes?.files.every((f) => f.undone) === true, 'every file undone');
    } finally {
      core.shutdown();
    }
  });
});
