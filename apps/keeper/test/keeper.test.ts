// The built keeper as a separate process: it joins with an invite, an admin approves, it takes what the admin
// writes, and after a restart it still has it and is still a member.
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Core, FileSigner } from '@lonca/core';
import type { Channel, Frame, Message, WorkspaceState, WorkspaceSummary } from '@lonca/protocol';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { describe as describeLines, openKeeper, parseArgs, readStatus } from '../src/keeper.js';

const here = join(import.meta.dirname, '..');
const bundle = join(mkdtempSync(join(tmpdir(), 'lonca-keeper-build-')), 'keeper.mjs');
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const children: ChildProcess[] = [];
const cores: Core[] = [];

beforeAll(async () => {
  await build({
    entryPoints: [join(here, 'src/main.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner: { js: "import { createRequire as __r } from 'node:module';\nconst require = __r(import.meta.url);" },
    define: { KEEPER_VERSION: '"test"' },
    logLevel: 'silent',
  });
});

afterAll(() => {
  for (const c of children) c.kill();
  for (const c of cores) c.shutdown();
});

function keeperProcess(home: string, args: string[]) {
  const child = spawn(process.execPath, [bundle, ...args], {
    env: { ...process.env, LONCA_HOME: home, LONCA_PEER_HOST: '127.0.0.1', LONCA_PEER_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let out = '';
  child.stdout?.on('data', (c: Buffer) => {
    out += c.toString();
  });
  child.stderr?.on('data', (c: Buffer) => {
    out += c.toString();
  });
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, output: () => out, exited };
}

function admin(dir: string) {
  const core = new Core({
    appDir: dir,
    language: 'tr',
    env: { PATH: '' },
    platform: 'linux',
    runner: async () => ({ code: 1, stdout: '', stderr: '', timedOut: false, failed: true }),
    signer: new FileSigner(join(dir, 'identity.json')),
    peer: { host: '127.0.0.1', port: 0 },
  });
  cores.push(core);
  let id = 0;
  const call = async <T>(method: string, params?: unknown): Promise<T> => {
    const reply: Frame = await core.answer({ id: ++id, method, params });
    if ('error' in reply && reply.error) throw new Error(reply.error.code);
    return (reply as { result: T }).result;
  };
  return { core, call };
}

async function until<T>(fn: () => Promise<T | undefined | false> | T | undefined | false, what: string, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out: ${what}`);
}

describe('the keeper command line', () => {
  it('reads its arguments', () => {
    expect(parseArgs([])).toEqual({ kind: 'run' });
    expect(parseArgs(['join', 'RUMPUS1.x', '--name', 'Sunucu'])).toEqual({
      kind: 'join',
      code: 'RUMPUS1.x',
      name: 'Sunucu',
    });
    expect(parseArgs(['join', '--name=Ev', 'rumpus://join/RUMPUS1.x'])).toEqual({
      kind: 'join',
      code: 'rumpus://join/RUMPUS1.x',
      name: 'Ev',
    });
    expect(parseArgs(['join', 'RUMPUS1.x', '--until-joined'])).toEqual({
      kind: 'join',
      code: 'RUMPUS1.x',
      untilJoined: true,
    });
    expect(() => parseArgs(['join'])).toThrow('one invite code');
    expect(() => parseArgs(['join', 'a', 'b'])).toThrow('one invite code');
    expect(() => parseArgs(['join', 'a', '--name'])).toThrow('--name');
    expect(() => parseArgs(['serve'])).toThrow('unknown command');
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
  });

  it('describes who is reachable in one line per workspace', () => {
    expect(
      describeLines([
        {
          id: 'a',
          name: 'Ekip',
          members: [
            { name: 'Sunucu', role: 'viewer', me: true, online: true },
            { name: 'Kaan', role: 'admin', online: true },
            { name: 'Arda', role: 'editor', online: false },
          ],
          address: '100.64.0.9:47640',
        },
        { id: 'b', name: 'Başka', state: 'joining', members: [] },
      ]),
    ).toEqual(['Ekip: 2 other members, online: Kaan (listening on 100.64.0.9:47640)', 'Başka: joining']);
  });

  it('joins, keeps what is written, and is still a member after a restart', async () => {
    const kaan = admin(tmp('lonca-keeper-admin-'));
    await kaan.call('settings.update', { profile: { name: 'Kaan' } });
    const team = await kaan.call<WorkspaceSummary>('workspaces.create', { name: 'Ekip' });
    const state = await until(async () => {
      const s = await kaan.call<WorkspaceState>('workspace.get');
      return s.address ? s : undefined;
    }, 'kaan listens');
    const genel = state.channels[0] as Channel;
    const { code } = await kaan.call<{ code: string }>('invites.create', { role: 'viewer' });

    const home = tmp('lonca-keeper-home-');
    const first = keeperProcess(home, ['join', code, '--name', 'Sunucu']);
    const request = await until(
      async () => (await kaan.call<WorkspaceState>('workspace.get')).joins?.find((j) => j.name === 'Sunucu'),
      'the keeper asks to join',
    );
    expect(request.role).toBe('viewer');
    await until(() => first.output().includes('asked to join Ekip as "Sunucu"'), 'the keeper says it asked');
    await kaan.call('invites.answer', { id: request.id, approve: true });
    await until(() => /Ekip: 1 other member, online: Kaan/.test(first.output()), 'the keeper reports Kaan online');
    await until(() => first.output().includes('joined Ekip;'), 'the keeper says it joined');
    // A second keeper on the same folder (the service started while a join runs) stops at once.
    const second = keeperProcess(home, ['run']);
    expect(await second.exited).toBe(1);
    expect(second.output()).toContain('another keeper uses');

    await kaan.call('messages.send', { channelId: genel.id, text: 'Sabah bakarız' });
    // The keeper's own log does not show messages; wait for Kaan to have reached it, then stop it.
    await until(async () => {
      const s = await kaan.call<WorkspaceState>('workspace.get');
      return s.members?.find((m) => m.name === 'Sunucu')?.online === true;
    }, 'kaan reaches the keeper');
    await new Promise((r) => setTimeout(r, 1500));
    first.child.kill('SIGTERM');
    await first.exited;

    expect(readStatus(home)).toMatchObject({ workspaces: [{ id: team.id, name: 'Ekip' }] });
    expect(readStatus(home).device).toBeTruthy();

    // The same data folder opened again (in this process, to read it): the message is there, the role too.
    const again = openKeeper({ home, peerHost: '127.0.0.1' });
    cores.push(again.core);
    const s = await again.call<WorkspaceState>('workspaces.open', { id: team.id });
    expect(s.role).toBe('viewer');
    const page = await again.call<{ messages: Message[] }>('messages.list', { channelId: genel.id });
    expect(page.messages.map((m) => m.text)).toContain('Sabah bakarız');
  }, 60_000);

  it('says how to use it when the arguments are wrong', async () => {
    const p = keeperProcess(tmp('lonca-keeper-usage-'), ['join']);
    expect(await p.exited).toBe(2);
    expect(p.output()).toContain('join takes one invite code');
    expect(p.output()).toContain('Usage:');
  });
});
