import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Channel, Frame, GitState, ProjectView, Response, WorkspaceState } from '@lonca/protocol';
import { describe, expect, it } from 'vitest';
import type { AgentSession, DriverEvent, OpenSession, SessionOptions } from '../src/drivers/types.js';
import { run } from '../src/proc.js';
import { parseProgress, parseStatus, projectOf, within } from '../src/projects.js';
import { Core } from '../src/server.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

const PROGRESS = `# CowFarm — progress

Step-by-step state of the game.

## Where we left off

Old paragraph.

2026-10-16: the price list is in Config. Visibility is private.

## Milestones

- [x] Concept written
- [ ] Published

## Next

1. Publish the place from Studio.
2. Turn DebugMutations off.
`;

function repo(): string {
  const dir = tmp('lonca-repo-');
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  writeFileSync(join(dir, 'progress.md'), PROGRESS);
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'First');
  return dir;
}

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
    appDir: tmp('lonca-projects-'),
    language: 'en',
    env: { PATH: bin },
    platform: 'linux',
    // git runs for real; the CLI checks are answered here.
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
  return { core, call, sessions, sent };
}

describe('project helpers', () => {
  it('reads git status, Fabrika progress files and nested folders', () => {
    expect(
      parseStatus(
        '# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b src/a.ts\n? new.txt\n',
      ),
    ).toEqual({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1, changes: 1, untracked: 1 });
    expect(parseStatus('# branch.head (detached)\n')).toEqual({ changes: 0, untracked: 0 });
    const p = parseProgress(PROGRESS);
    expect(p.leftOff).toBe('Old paragraph.\n\n2026-10-16: the price list is in Config. Visibility is private.');
    expect(p.milestones).toEqual([
      { text: 'Concept written', done: true },
      { text: 'Published', done: false },
    ]);
    expect(p.next).toEqual(['Publish the place from Studio.', 'Turn DebugMutations off.']);
    // A long history keeps its newest paragraphs.
    const long = parseProgress(
      `## Where we left off\n\n${Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${'x'.repeat(300)}`).join('\n\n')}`,
    );
    expect(long.leftOff.length).toBeLessThanOrEqual(4000);
    expect(long.leftOff.endsWith(`Paragraph 29 ${'x'.repeat(300)}`)).toBe(true);
    expect(within('C:\\Work\\Game\\src', 'c:/work/game', 'win32')).toBe(true);
    expect(within('C:\\Work\\Gamer', 'C:\\Work\\Game', 'win32')).toBe(false);
    const outer = { id: 'o', folder: '/w' };
    const inner = { id: 'i', folder: '/w/games/cow' };
    expect(projectOf('/w/games/cow/src', [outer, inner], 'linux')).toBe(inner);
    expect(projectOf('/w/tools', [outer, inner], 'linux')).toBe(outer);
    expect(projectOf('/elsewhere', [outer, inner], 'linux')).toBeUndefined();
  });
});

describe('projects through the core', () => {
  it('seeds the page from progress.md, tells the agent, takes its updates and shows git state', async () => {
    const { call, sessions } = setup();
    const folder = repo();
    const ws = await call<WorkspaceState>('workspace.get');
    const created = await call<ProjectView>('projects.save', {
      name: 'CowFarm',
      description: 'A merge game.',
      areas: [{ path: 'src/ui', member: ws.me.id, note: 'menus' }, { path: 'docs' }],
      folder,
    });
    expect(created.folder).toBe(folder);
    expect(created.status.milestones).toHaveLength(2);
    expect(created.status.next[0]).toBe('Publish the place from Studio.');
    expect(created.areas).toEqual([
      { path: 'src/ui', member: ws.me.id, note: 'menus' },
      { path: 'docs', note: '' },
    ]);

    const git = await call<GitState>('projects.git', { id: created.id });
    expect(git).toMatchObject({ repo: true, branch: 'main', changes: 0 });
    expect(git.commits?.[0]?.subject).toBe('First');
    writeFileSync(join(folder, 'src', 'a.ts'), 'export const a = 2;\n');
    writeFileSync(join(folder, 'b.ts'), '');
    expect(await call<GitState>('projects.git', { id: created.id })).toMatchObject({ changes: 1, untracked: 1 });
    // No upstream: pull refuses with git's own words, and nothing breaks.
    const pulled = await call<{ ok: boolean; output: string }>('projects.pull', { id: created.id });
    expect(pulled.ok).toBe(false);

    // An agent in a folder inside the project gets the page and the areas in its prompt.
    await call('agents.save', {
      kind: 'claude-code',
      name: 'Claude',
      handle: 'claude',
      folder: join(folder, 'src'),
      mode: 'edit',
    });
    const genel = (ws.channels.find((c) => c.kind === 'channel') as Channel).id;
    await call('messages.send', { channelId: genel, text: '@claude what is next?' });
    for (let i = 0; i < 100 && sessions.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    const session = sessions[0];
    expect(session?.opts.systemPrompt).toContain('You work in the project "CowFarm". A merge game.');
    expect(session?.opts.systemPrompt).toContain('1. Publish the place from Studio.');
    expect(session?.opts.systemPrompt).toContain(`- src/ui: ${ws.me.name} (menus)`);
    expect(session?.opts.systemPrompt).toContain('- docs: shared');
    expect(session?.opts.systemPrompt).toContain('a record, not a lock');

    const mcp = session?.opts.mcp;
    const tool = async (name: string, args: Record<string, unknown>) => {
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
    expect(await tool('read_status', {})).toContain('[x] Concept written');
    expect(
      await tool('update_status', {
        left_off: 'Published privately; waiting on the thumbnail.',
        milestones: [
          { text: 'Concept written', done: true },
          { text: 'Published', done: true },
        ],
      }),
    ).toBe('Saved the status page of "CowFarm".');
    expect(await tool('update_status', { next: ['x'.repeat(400)] })).toMatch(/^Not saved: invalid_project/);
    const [after] = await call<ProjectView[]>('projects.list');
    expect(after?.status).toMatchObject({
      leftOff: 'Published privately; waiting on the thumbnail.',
      next: ['Publish the place from Studio.', 'Turn DebugMutations off.'],
      by: 'Claude',
    });
    expect(after?.status.milestones.every((m) => m.done)).toBe(true);
    expect(await call<string>('projects.export', { id: created.id })).toContain('- [x] Published');

    // A person edits the page; the folder setting alone stays on this computer.
    const edited = await call<ProjectView>('projects.status', { id: created.id, next: [] });
    expect(edited.status.next).toEqual([]);
    expect(edited.status.by).toBe(ws.me.name);
    const unlinked = await call<ProjectView>('projects.save', {
      id: created.id,
      name: 'CowFarm',
      description: 'A merge game.',
      areas: created.areas,
      folder: '',
    });
    expect(unlinked.folder).toBeUndefined();
    await expect(call('projects.git', { id: created.id })).rejects.toThrow('no_folder');
    await call('projects.delete', { id: created.id });
    expect(await call<ProjectView[]>('projects.list')).toEqual([]);
  });
});
