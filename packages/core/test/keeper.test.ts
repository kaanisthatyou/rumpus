// An always-on member (PLAN.md 6.5): a core without a window, on a machine that stays up, keeps the workspace
// for members who are rarely online together. Here Arda's app is closed while Kaan writes, then Kaan's is closed
// before Arda's opens again: Arda gets the message from the keeper alone, and the other way round.
import { mkdtempSync } from 'node:fs';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Channel, Frame, Message, Response, WorkspaceState, WorkspaceSummary } from '@lonca/protocol';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { FileSigner } from '../src/identity.js';
import { Core } from '../src/server.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const cores: Core[] = [];
afterAll(() => {
  for (const c of cores) c.shutdown();
});

/** One app (or the keeper) on its own folder; opening it again on the same folder is a restart. */
function app(dir: string, port = 0) {
  const core = new Core({
    appDir: dir,
    language: 'tr',
    env: { PATH: '' },
    platform: 'linux',
    runner: async () => ({ code: 1, stdout: '', stderr: '', timedOut: false, failed: true }),
    signer: new FileSigner(join(dir, 'identity.json')),
    peer: { host: '127.0.0.1', port },
  });
  cores.push(core);
  let listener: (f: unknown) => void = () => {};
  const sent: Frame[] = [];
  core.attach({ send: (f) => sent.push(f), onFrame: (l) => (listener = l) });
  let id = 0;
  const call = async <T>(method: string, params?: unknown): Promise<T> => {
    const rid = ++id;
    listener({ id: rid, method, params });
    for (let i = 0; i < 2000; i++) {
      const r = sent.find((f) => 'id' in f && f.id === rid && ('result' in f || 'error' in f)) as Response | undefined;
      if (r) {
        if ('error' in r) throw new Error(r.error.code);
        return r.result as T;
      }
      await new Promise((res) => setTimeout(res, 5));
    }
    throw new Error(`no answer: ${method}`);
  };
  return { core, call };
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

async function until<T>(fn: () => Promise<T | undefined | false>, what: string, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out: ${what}`);
}

type App = ReturnType<typeof app>;

async function admit(admin: App, joiner: App, role: 'viewer' | 'editor', name: string, ws: string): Promise<void> {
  const { code } = await admin.call<{ code: string }>('invites.create', { role });
  await joiner.call('invites.join', { code });
  const request = await until(
    async () => (await admin.call<WorkspaceState>('workspace.get')).joins?.find((j) => j.name === name),
    `${name} asks`,
  );
  await admin.call('invites.answer', { id: request.id, approve: true });
  await until(async () => {
    const list = await joiner.call<WorkspaceSummary[]>('workspaces.list');
    return list.find((w) => w.id === ws && !w.state);
  }, `${name} approved`);
}

const texts = async (a: App, channelId: string) =>
  (await a.call<{ messages: Message[] }>('messages.list', { channelId })).messages.map((m) => m.text);

describe('an always-on member', () => {
  it('passes on what was written while the others were closed', async () => {
    const dirs = { kaan: tmp('lonca-k-kaan-'), arda: tmp('lonca-k-arda-'), keeper: tmp('lonca-k-keeper-') };
    let kaan = app(dirs.kaan);
    let arda = app(dirs.arda);
    const keeper = app(dirs.keeper);
    await kaan.call('settings.update', { profile: { name: 'Kaan' } });
    await arda.call('settings.update', { profile: { name: 'Arda' } });
    await keeper.call('settings.update', { profile: { name: 'Sunucu' } });

    const team = await kaan.call<WorkspaceSummary>('workspaces.create', { name: 'Ekip' });
    const genel = (
      await until(async () => {
        const s = await kaan.call<WorkspaceState>('workspace.get');
        return s.address ? s : undefined;
      }, 'kaan listens')
    ).channels[0] as Channel;
    // Alone in the workspace: what Kaan writes is on this computer only.
    const first = await kaan.call<Message>('messages.send', { channelId: genel.id, text: 'Daha kimse yok' });
    await new Promise((r) => setTimeout(r, 500));
    expect((await kaan.call<WorkspaceState>('workspace.get')).delivered ?? 0).toBeLessThan(first.created);
    await admit(kaan, keeper, 'viewer', 'Sunucu', team.id);
    // Once another member's computer has it, the window can stop marking it.
    await until(
      async () => ((await kaan.call<WorkspaceState>('workspace.get')).delivered ?? 0) >= first.created,
      'delivered',
    );
    await admit(kaan, arda, 'editor', 'Arda', team.id);
    await keeper.call('workspaces.open', { id: team.id });
    await until(async () => {
      const s = await arda.call<WorkspaceState>('workspaces.open', { id: team.id });
      return s.members?.length === 3 && s.channels.length ? s : undefined;
    }, 'arda sees all three');

    // Arda closes the app; Kaan writes; the keeper takes it; Kaan closes the app.
    arda.core.shutdown();
    await kaan.call('messages.send', { channelId: genel.id, text: 'Sen yokken yazdım' });
    await until(async () => (await texts(keeper, genel.id)).includes('Sen yokken yazdım'), 'the keeper has it');
    kaan.core.shutdown();

    // Arda opens the app again: only the keeper is there to give it.
    arda = app(dirs.arda);
    await arda.call('workspaces.open', { id: team.id });
    await until(async () => (await texts(arda, genel.id)).includes('Sen yokken yazdım'), 'arda caught up');
    const unread = (await arda.call<WorkspaceState>('workspace.get')).unread;
    expect(unread?.[genel.id]?.count).toBeGreaterThanOrEqual(1);

    // Arda answers and closes; Kaan opens and finds the answer.
    await arda.call('messages.send', { channelId: genel.id, text: 'Gördüm, sağ ol' });
    await until(async () => (await texts(keeper, genel.id)).includes('Gördüm, sağ ol'), 'the keeper has the answer');
    arda.core.shutdown();
    kaan = app(dirs.kaan);
    await kaan.call('workspaces.open', { id: team.id });
    await until(async () => (await texts(kaan, genel.id)).includes('Gördüm, sağ ol'), 'kaan caught up');
  }, 60_000);
});

describe('a team nobody opened for more than a month', () => {
  afterEach(() => vi.useRealTimers());

  it("renews the members' certificates that ran out, and they sync once more", async () => {
    const dirs = { kaan: tmp('lonca-r-kaan-'), arda: tmp('lonca-r-arda-') };
    // Fixed ports, as installed apps have (47640): two apps that both restart find each other again.
    const ports = { kaan: await freePort(), arda: await freePort() };
    let kaan = app(dirs.kaan, ports.kaan);
    let arda = app(dirs.arda, ports.arda);
    await kaan.call('settings.update', { profile: { name: 'Kaan' } });
    await arda.call('settings.update', { profile: { name: 'Arda' } });
    const team = await kaan.call<WorkspaceSummary>('workspaces.create', { name: 'Uzun' });
    const genel = (
      await until(async () => {
        const s = await kaan.call<WorkspaceState>('workspace.get');
        return s.address ? s : undefined;
      }, 'kaan listens')
    ).channels[0] as Channel;
    await admit(kaan, arda, 'editor', 'Arda', team.id);
    await arda.call('workspaces.open', { id: team.id });
    kaan.core.shutdown();
    arda.core.shutdown();

    // Forty days later (only the clock moves; timers keep running).
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 40 * 24 * 60 * 60 * 1000, shouldAdvanceTime: true });
    kaan = app(dirs.kaan, ports.kaan);
    await kaan.call('workspaces.open', { id: team.id });
    // Arda's certificate ran out meanwhile; the creator's own does not (it is the workspace's root).
    expect((await kaan.call<WorkspaceState>('workspace.get')).role).toBe('admin');
    await kaan.call('messages.send', { channelId: genel.id, text: 'Döndüm' });
    arda = app(dirs.arda, ports.arda);
    expect((await arda.call<WorkspaceState>('workspaces.open', { id: team.id })).role).toBeUndefined();
    await until(async () => (await texts(arda, genel.id)).includes('Döndüm'), 'arda gets it');
    await until(async () => (await arda.call<WorkspaceState>('workspace.get')).role === 'editor', 'arda renewed');
    await arda.call('messages.send', { channelId: genel.id, text: 'Hoş geldin' });
    await until(async () => (await texts(kaan, genel.id)).includes('Hoş geldin'), 'kaan gets the answer');
  }, 60_000);
});
