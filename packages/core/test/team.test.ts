import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Channel, Frame, Message, Response, WorkspaceState, WorkspaceSummary } from '@lonca/protocol';
import { afterAll, describe, expect, it } from 'vitest';
import { eventPayload, LocalSigner, type SignedEvent } from '../src/identity.js';
import { Membership } from '../src/membership.js';
import { peerAddressAllowed } from '../src/peer.js';
import { Core } from '../src/server.js';
import { WorkspaceStore } from '../src/store.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const cores: Core[] = [];
afterAll(() => {
  for (const c of cores) c.shutdown();
});

function app(name: string) {
  const core = new Core({
    appDir: tmp('lonca-team-'),
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
  return { core, call, name };
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

describe('team workspaces between two apps', () => {
  it('invites, approves, syncs both ways, enforces roles and removes a member', async () => {
    const kaan = app('Kaan');
    const arda = app('Arda');
    await kaan.call('settings.update', { profile: { name: 'Kaan' } });
    await arda.call('settings.update', { profile: { name: 'Arda' } });

    const team = await kaan.call<WorkspaceSummary>('workspaces.create', { name: 'Ekip' });
    const kState = await until(async () => {
      const s = await kaan.call<WorkspaceState>('workspace.get');
      return s.address ? s : undefined;
    }, 'kaan listens');
    expect(kState).toMatchObject({ kind: 'team', role: 'admin', members: [{ name: 'Kaan', role: 'admin', me: true }] });
    const genel = (kState.channels[0] as Channel).id;

    // Only admins invite; a code carries the address and a one-time token.
    const { code } = await kaan.call<{ code: string }>('invites.create', { role: 'editor' });
    expect(code.startsWith('LONCA1.')).toBe(true);
    await expect(arda.call('invites.join', { code: 'LONCA1.bozuk' })).rejects.toThrow('bad_code');
    const joining = await arda.call<WorkspaceSummary>('invites.join', { code });
    expect(joining).toMatchObject({ id: team.id, name: 'Ekip', state: 'joining' });
    await expect(arda.call('invites.join', { code })).rejects.toThrow('already_member');

    const request = await until(
      async () => (await kaan.call<WorkspaceState>('workspace.get')).joins?.[0],
      'join request',
    );
    expect(request).toMatchObject({ name: 'Arda', role: 'editor' });
    await kaan.call('invites.answer', { id: request.id, approve: true });

    // Arda's app hears the answer, pulls the workspace and can open it.
    await until(async () => {
      const list = await arda.call<WorkspaceSummary[]>('workspaces.list');
      return list.find((w) => w.id === team.id && !w.state);
    }, 'approved');
    const aState = await until(async () => {
      const s = await arda.call<WorkspaceState>('workspaces.open', { id: team.id });
      return s.channels.length && s.members?.length === 2 ? s : undefined;
    }, 'arda pulled the workspace');
    expect(aState).toMatchObject({ role: 'editor', channels: [{ id: genel, name: 'genel' }] });

    // Messages both ways.
    await arda.call('messages.send', { channelId: genel, text: 'Merhaba, ben Arda' });
    await until(async () => {
      const page = await kaan.call<{ messages: Message[] }>('messages.list', { channelId: genel });
      return page.messages.some(
        (m) => m.text === 'Merhaba, ben Arda' && m.author.kind === 'person' && m.author.name === 'Arda',
      );
    }, 'kaan got arda');
    await kaan.call('messages.send', { channelId: genel, text: 'Hoş geldin' });
    await until(async () => {
      const page = await arda.call<{ messages: Message[] }>('messages.list', { channelId: genel });
      return page.messages.some((m) => m.text === 'Hoş geldin');
    }, 'arda got kaan');

    // An editor cannot make channels; an admin can make the editor a viewer, and remove them.
    await expect(arda.call('channels.create', { name: 'gizli' })).rejects.toThrow('not_allowed');
    const ardaDevice = aState.members?.find((m) => m.me)?.device ?? '';
    await kaan.call('members.setRole', { device: ardaDevice, role: 'viewer' });
    await until(async () => (await arda.call<WorkspaceState>('workspace.get')).role === 'viewer', 'arda became viewer');
    await kaan.call('members.remove', { device: ardaDevice });
    await until(async () => (await arda.call<WorkspaceState>('workspace.get')).role === undefined, 'arda removed');
    await expect(arda.call('messages.send', { channelId: genel, text: 'hâlâ burada mıyım?' })).rejects.toThrow(
      'not_allowed',
    );
    expect((await kaan.call<WorkspaceState>('workspace.get')).members?.map((m) => m.name)).toEqual(['Kaan']);
  }, 60_000);
});

describe('membership checks', () => {
  async function sign(signer: LocalSigner, e: Omit<SignedEvent, 'sig'>, ws = 'w1'): Promise<SignedEvent> {
    return { ...e, sig: await signer.sign(eventPayload(e, ws)) };
  }

  it('accepts the root and certified members, refuses forgeries, wrong roles and other owners', async () => {
    const store = new WorkspaceStore(join(tmp('lonca-mem-'), 'lonca.db'), 'X');
    const m = new Membership(store, 'w1');
    const root = new LocalSigner();
    const ed = new LocalSigner();
    const stranger = new LocalSigner();
    const at = (n: number) => `${(Date.now() + n).toString(36).padStart(10, '0')}.0000.R`;
    const genesis = await sign(root, {
      id: 'g',
      author: 'R',
      n: 1,
      at: at(0),
      type: 'workspace.created',
      data: { id: 'w1', name: 'Ekip', root: 'R', publicKey: root.publicKey() },
    });
    expect(m.verify({ ...genesis })).toBe('ok');
    expect(m.verify(await sign(root, { ...genesis, id: 'g2' }, 'w2'))).toBe('bad_signature');
    store.ingest(genesis);
    const rootCert = await sign(root, {
      id: 'c0',
      author: 'R',
      n: 2,
      at: at(1),
      type: 'member.certified',
      data: { device: 'R', publicKey: root.publicKey(), name: 'Kaan', role: 'admin', expires: Date.now() + 1e9 },
    });
    expect(m.verify(rootCert)).toBe('ok');
    store.ingest(rootCert);
    const edCert = await sign(root, {
      id: 'c1',
      author: 'R',
      n: 3,
      at: at(2),
      type: 'member.certified',
      data: { device: 'E', publicKey: ed.publicKey(), name: 'Arda', role: 'editor', expires: Date.now() + 1e9 },
    });
    store.ingest(edCert);

    const msg = (author: string, by: string, id = 'm1') => ({
      id,
      author,
      n: 1,
      at: at(3),
      type: 'message.posted',
      data: { id, channelId: 'c', author: { kind: 'person', id: by, name: by }, text: 'x', created: 1 },
    });
    expect(m.verify(await sign(ed, msg('E', 'E')))).toBe('ok');
    expect(m.verify(await sign(ed, msg('E', 'R')))).toBe('not_allowed');
    expect(m.verify(await sign(stranger, msg('E', 'E')))).toBe('bad_signature');
    expect(m.verify(await sign(stranger, msg('S', 'S')))).toBe('unknown_author');
    const channel = {
      id: 'k',
      author: 'E',
      n: 2,
      at: at(4),
      type: 'channel.created',
      data: { id: 'k', name: 'x', kind: 'channel' },
    };
    expect(m.verify(await sign(ed, channel))).toBe('not_allowed');
    const selfPromote = {
      id: 'p',
      author: 'E',
      n: 3,
      at: at(5),
      type: 'member.certified',
      data: { device: 'E', publicKey: ed.publicKey(), name: 'Arda', role: 'admin', expires: Date.now() + 1e9 },
    };
    expect(m.verify(await sign(ed, selfPromote))).toBe('not_allowed');
    // The root's agent cannot be changed by the editor.
    store.ingest(
      await sign(root, { id: 'a', author: 'R', n: 4, at: at(6), type: 'agent.saved', data: { id: 'ag1', created: 1 } }),
    );
    expect(
      m.verify(
        await sign(ed, {
          id: 'a2',
          author: 'E',
          n: 4,
          at: at(7),
          type: 'agent.saved',
          data: { id: 'ag1', created: 1 },
        }),
      ),
    ).toBe('not_allowed');
    // Removed with one event known: that one still counts, later ones (even stamped earlier) do not.
    store.ingest(
      await sign(root, {
        id: 'r',
        author: 'R',
        n: 5,
        at: at(8),
        type: 'member.removed',
        data: { device: 'E', at: Date.now(), upTo: 1 },
      }),
    );
    expect(m.verify(await sign(ed, msg('E', 'E')))).toBe('ok');
    expect(m.verify(await sign(ed, { ...msg('E', 'E', 'm2'), n: 2, at: at(-1000) }))).toBe('expired');
  });

  it('lets only loopback and Tailscale addresses call', () => {
    expect(peerAddressAllowed('127.0.0.1')).toBe(true);
    expect(peerAddressAllowed('::ffff:100.101.1.2')).toBe(true);
    expect(peerAddressAllowed('fd7a:115c:a1e0::1')).toBe(true);
    expect(peerAddressAllowed('192.168.1.5')).toBe(false);
    expect(peerAddressAllowed('100.128.0.1')).toBe(false);
    expect(peerAddressAllowed(undefined)).toBe(false);
  });
});
