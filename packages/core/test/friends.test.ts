// Friends (PLAN.md 5.20): two apps over loopback. A friend code, a request, an answer, and the conversation that
// comes of it: a workspace of two that syncs like any other.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Frame, FriendsState, Message, Response, WorkspaceState, WorkspaceSummary } from '@lonca/protocol';
import { afterAll, describe, expect, it } from 'vitest';
import { makeFriendCode, readFriendCode } from '../src/friends.js';
import { LocalSigner } from '../src/identity.js';
import { Core } from '../src/server.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const cores: Core[] = [];
afterAll(() => {
  for (const c of cores) c.shutdown();
});

function app(appDir = tmp('lonca-friends-')) {
  const core = new Core({
    appDir,
    language: 'tr',
    env: { PATH: '' },
    platform: 'linux',
    runner: async () => ({ code: 1, stdout: '', stderr: '', timedOut: false, failed: true }),
    signer: new LocalSigner(),
    peer: { host: '127.0.0.1', port: 0 },
  });
  cores.push(core);
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
  const events = <T>(event: string) =>
    sent.filter((f) => 'event' in f && f.event === event).map((f) => (f as { data: T }).data);
  return { core, call, events, appDir };
}

async function until<T>(fn: () => Promise<T | undefined | false>, what: string, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out: ${what}`);
}

describe('a friend code', () => {
  it('names a computer and reads back; anything else is refused', () => {
    const card = { device: 'device-0001', publicKey: 'k'.repeat(60), name: 'Kaan', address: '100.64.0.1:47640' };
    const code = makeFriendCode(card);
    expect(code.startsWith('RUMPUSF1.')).toBe(true);
    expect(readFriendCode(` ${code}\n`)).toEqual(card);
    for (const bad of ['', 'RUMPUSF1.', 'RUMPUS1.abc', `${code}!`, 'RUMPUSF1.e30', 42]) {
      expect(() => readFriendCode(bad)).toThrow('bad_friend_code');
    }
  });
});

describe('friends between two apps', () => {
  it('asks, accepts, and talks in a conversation of two', async () => {
    const kaan = app();
    const arda = app();
    await kaan.call('settings.update', { profile: { name: 'Kaan', status: 'derliyor' } });
    await arda.call('settings.update', { profile: { name: 'Arda' } });

    // Asking for the friends starts the app listening, and with that it has a code to hand out.
    const mine = await arda.call<FriendsState>('friends.get', { listen: true });
    expect(mine).toMatchObject({ friends: [], requests: [], sent: [] });
    const code = mine.code as string;
    expect(code.startsWith('RUMPUSF1.')).toBe(true);

    await expect(kaan.call('friends.add', { code: 'merhaba' })).rejects.toThrow('bad_friend_code');
    await expect(arda.call('friends.add', { code })).rejects.toThrow('friend_self');
    // A code that names a computer that does not answer.
    const nowhere = makeFriendCode({ ...readFriendCode(code), device: 'someone-else', address: '127.0.0.1:9' });
    await expect(kaan.call('friends.add', { code: nowhere })).rejects.toThrow('unreachable');
    // The right address but another device: that computer says it is not the one.
    const wrong = makeFriendCode({ ...readFriendCode(code), device: 'someone-else' });
    await expect(kaan.call('friends.add', { code: wrong })).rejects.toThrow('friend_refused');

    expect(await kaan.call<FriendsState>('friends.add', { code })).toMatchObject({ sent: [{ name: 'Arda' }] });
    // Asking twice is one request.
    await kaan.call('friends.add', { code });
    const asked = await until(async () => {
      const s = await arda.call<FriendsState>('friends.get', { listen: true });
      return s.requests.length ? s : undefined;
    }, 'the request at arda');
    expect(asked.requests).toMatchObject([{ name: 'Kaan' }]);
    expect(asked.requests).toHaveLength(1);
    expect(arda.events<FriendsState>('friends.changed').some((s) => s.requests.length === 1)).toBe(true);
    await expect(arda.call('friends.answer', { id: 'no-such', accept: true })).rejects.toThrow('not_found');

    const accepted = await arda.call<FriendsState>('friends.answer', { id: asked.requests[0]?.id, accept: true });
    expect(accepted).toMatchObject({ requests: [], friends: [{ name: 'Kaan' }] });
    const dm = accepted.friends[0]?.workspace as string;

    // Kaan's app hears the answer and takes the conversation; it stands under the friends, not the workspaces.
    const got = await until(async () => {
      const s = await kaan.call<FriendsState>('friends.get', { listen: true });
      return s.friends.length ? s : undefined;
    }, 'the friend at kaan');
    expect(got).toMatchObject({ sent: [], friends: [{ name: 'Arda', workspace: dm }] });
    const listed = (await kaan.call<WorkspaceSummary[]>('workspaces.list')).find((w) => w.id === dm);
    expect(listed).toMatchObject({ kind: 'team', friend: { name: 'Arda' } });
    await expect(kaan.call('friends.add', { code })).rejects.toThrow('already_friend');

    const kState = await until(async () => {
      const s = await kaan.call<WorkspaceState>('workspaces.open', { id: dm });
      return s.channels.length && s.members?.length === 2 ? s : undefined;
    }, 'kaan pulled the conversation');
    expect(kState).toMatchObject({ kind: 'team', role: 'admin', name: 'Arda', channels: [{ name: 'sohbet' }] });
    expect(kState.friend).toBe(got.friends[0]?.device);
    const channel = kState.channels[0]?.id as string;
    // Two people: nobody is invited into it.
    await expect(kaan.call('invites.create', { role: 'editor' })).rejects.toThrow('bad_request');
    // Nor does it have a look or roles of its own.
    await expect(kaan.call('workspace.look', { name: 'Biz' })).rejects.toThrow('bad_request');
    await expect(kaan.call('roles.save', { name: 'Dost' })).rejects.toThrow('bad_request');

    await kaan.call('messages.send', { channelId: channel, text: 'Selam Arda' });
    await arda.call('workspaces.open', { id: dm });
    await until(async () => {
      const page = await arda.call<{ messages: Message[] }>('messages.list', { channelId: channel });
      return page.messages.some((m) => m.text === 'Selam Arda');
    }, 'arda got the message');
    await arda.call('messages.send', { channelId: channel, text: 'Selam Kaan' });
    await until(async () => {
      const page = await kaan.call<{ messages: Message[] }>('messages.list', { channelId: channel });
      return page.messages.some((m) => m.text === 'Selam Kaan');
    }, 'kaan got the answer');

    // The friend is shown as their profile says, also where the list of friends is read from.
    await until(async () => {
      const s = await arda.call<WorkspaceState>('workspace.get');
      return s.members?.find((m) => !m.me)?.profile?.status === 'derliyor';
    }, "kaan's profile at arda");
    await kaan.call('settings.update', { profile: { name: 'Kaan Ç.' } });
    await until(async () => {
      const s = await arda.call<FriendsState>('friends.get', { listen: true });
      return s.friends[0]?.name === 'Kaan Ç.' && s.friends[0].online === true;
    }, "kaan's new name among arda's friends");
    expect((await arda.call<WorkspaceState>('workspace.get')).name).toBe('Kaan Ç.');

    // Removing a friend takes the conversation off this computer's lists, and the personal workspace opens.
    const after = await kaan.call<FriendsState>('friends.remove', { device: got.friends[0]?.device });
    expect(after.friends).toEqual([]);
    expect((await kaan.call<WorkspaceSummary[]>('workspaces.list')).some((w) => w.id === dm)).toBe(false);
    expect((await kaan.call<WorkspaceState>('workspace.get')).kind).toBe('personal');
    await expect(kaan.call('friends.remove', { device: 'nobody' })).rejects.toThrow('not_found');
  }, 60_000);

  it('a request that is turned down leaves nothing behind', async () => {
    const kaan = app();
    const arda = app();
    await kaan.call('settings.update', { profile: { name: 'Kaan' } });
    const code = (await arda.call<FriendsState>('friends.get', { listen: true })).code as string;
    await kaan.call('friends.add', { code });
    const asked = await until(async () => {
      const s = await arda.call<FriendsState>('friends.get', { listen: true });
      return s.requests[0];
    }, 'the request at arda');
    expect((await arda.call<FriendsState>('friends.answer', { id: asked.id, accept: false })).requests).toEqual([]);
    await until(
      async () => (await kaan.call<FriendsState>('friends.get', { listen: true })).sent.length === 0,
      'kaan heard the no',
    );
    expect((await kaan.call<FriendsState>('friends.get', { listen: true })).friends).toEqual([]);
    expect((await arda.call<WorkspaceSummary[]>('workspaces.list')).length).toBe(1);
    // A request can be taken back before it is answered.
    const again = await kaan.call<FriendsState>('friends.add', { code });
    expect((await kaan.call<FriendsState>('friends.cancel', { device: again.sent[0]?.device })).sent).toEqual([]);
  }, 60_000);
});
