// Profiles, the workspace's look, roles and what an invite shows (PLAN.md 5.19): two apps over loopback.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Frame,
  type InviteCheck,
  LIMITS,
  type Response,
  type RoleTag,
  type Settings,
  type WorkspaceState,
  type WorkspaceSummary,
} from '@lonca/protocol';
import { afterAll, describe, expect, it } from 'vitest';
import { Blobs, isAnimated } from '../src/blobs.js';
import { eventPayload, LocalSigner, type SignedEvent } from '../src/identity.js';
import { Membership } from '../src/membership.js';
import { Core } from '../src/server.js';
import { WorkspaceStore } from '../src/store.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const cores: Core[] = [];
afterAll(() => {
  for (const c of cores) c.shutdown();
});

/** A 1 × 1 PNG, and the same with one more byte after its end (another hash). */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const png = (extra = '') =>
  `data:image/png;base64,${Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.from(extra)]).toString('base64')}`;

function app() {
  const core = new Core({
    appDir: tmp('lonca-prof-'),
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
  const events = (event: string) =>
    sent.filter((f) => 'event' in f && f.event === event).map((f) => (f as { data: unknown }).data);
  return { core, call, events };
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

describe('pictures', () => {
  it('are taken by what their bytes are, within the size limit', () => {
    const blobs = new Blobs(tmp('lonca-faces-'));
    const ref = blobs.savePicture(png());
    expect(ref).toMatchObject({ mime: 'image/png' });
    expect(ref.animated).toBeUndefined();
    expect(blobs.has(ref.blob)).toBe(true);
    expect(blobs.picture(ref.blob)).toBe(png());
    // A text file that calls itself a picture, and a picture that is too large.
    expect(() =>
      blobs.savePicture(`data:image/png;base64,${Buffer.from('not a picture at all').toString('base64')}`),
    ).toThrow('picture_type');
    const large = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(LIMITS.picture)]);
    expect(() => blobs.savePicture(`data:image/png;base64,${large.toString('base64')}`)).toThrow('picture_too_large');
    expect(() => blobs.savePicture('https://example.com/a.png')).toThrow('picture_type');
  });

  it('from another computer are kept only under the hash of their own bytes', () => {
    const mine = new Blobs(tmp('lonca-faces-'));
    const theirs = new Blobs(tmp('lonca-faces-'));
    const ref = mine.savePicture(png());
    const bytes = Buffer.from(mine.base64(ref.blob), 'base64');
    expect(theirs.put(ref.blob, Buffer.concat([bytes, Buffer.from('x')]))).toBe(false);
    expect(theirs.put(ref.blob.replace('.png', '.gif'), bytes)).toBe(false);
    expect(theirs.put('../../evil.png', bytes)).toBe(false);
    expect(theirs.has(ref.blob)).toBe(false);
    expect(theirs.put(ref.blob, bytes)).toBe(true);
    expect(theirs.picture(ref.blob)).toBe(png());
  });

  it('that move are told from still ones', () => {
    const frame = Buffer.from([0x21, 0xf9, 0x04, 0, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0]);
    const head = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00', 'latin1');
    expect(isAnimated(Buffer.concat([head, frame]), 'image/gif')).toBe(false);
    expect(isAnimated(Buffer.concat([head, frame, frame]), 'image/gif')).toBe(true);
    const webp = (flags: number) =>
      Buffer.concat([
        Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00', 'latin1'),
        Buffer.from([flags, 0, 0, 0]),
      ]);
    expect(isAnimated(webp(0x02), 'image/webp')).toBe(true);
    expect(isAnimated(webp(0x10), 'image/webp')).toBe(false);
    expect(isAnimated(Buffer.from(PNG, 'base64'), 'image/png')).toBe(false);
  });
});

describe('profiles, the look of a workspace and roles between two apps', () => {
  it('shows a member as they present themselves, carries pictures over, and keeps the look and roles with admins', async () => {
    const kaan = app();
    const arda = app();
    await kaan.call('settings.update', {
      profile: { name: 'Kaan', bio: 'Oyun yapar.', status: 'derliyor', pronouns: 'o', color: '#3e9bdc' },
    });
    await arda.call('settings.update', { profile: { name: 'Arda' } });
    // The fields have limits, and a color is a color.
    await expect(kaan.call('settings.update', { profile: { bio: 'x'.repeat(LIMITS.bio + 1) } })).rejects.toThrow(
      'invalid_settings',
    );
    await expect(kaan.call('settings.update', { profile: { color: 'red' } })).rejects.toThrow('invalid_settings');
    await expect(kaan.call('profile.picture', { slot: 'cover', data: png() })).rejects.toThrow('bad_request');
    const withAvatar = await kaan.call<Settings>('profile.picture', { slot: 'avatar', data: png() });
    const avatar = withAvatar.profile.avatar;
    expect(avatar).toMatchObject({ mime: 'image/png' });
    expect(await kaan.call('blobs.get', { blob: avatar?.blob })).toBe(png());

    const team = await kaan.call<WorkspaceSummary>('workspaces.create', { name: 'Ekip' });
    await until(async () => (await kaan.call<WorkspaceState>('workspace.get')).address, 'kaan listens');
    await expect(kaan.call('workspaces.create', { name: ' ' })).rejects.toThrow('bad_request');
    // The workspace gets a line about it and an icon; a name over the limit is refused.
    await expect(kaan.call('workspace.look', { name: 'x'.repeat(LIMITS.workspaceName + 1) })).rejects.toThrow(
      'bad_request',
    );
    await kaan.call('workspace.look', { about: 'Oyun ekibi' });
    const looked = await kaan.call<WorkspaceState>('workspace.picture', { slot: 'icon', data: png('icon') });
    expect(looked).toMatchObject({ name: 'Ekip', about: 'Oyun ekibi', icon: { mime: 'image/png' } });
    expect((await kaan.call<WorkspaceSummary[]>('workspaces.list')).find((w) => w.id === team.id)?.icon).toEqual(
      looked.icon,
    );

    // The invite says how the workspace looks and whether the code still works, before anything is asked.
    const { code } = await kaan.call<{ code: string }>('invites.create', { role: 'editor' });
    const seen = await arda.call<InviteCheck>('invites.check', { code });
    expect(seen).toMatchObject({
      name: 'Ekip',
      reachable: true,
      joined: false,
      invite: { state: 'valid', role: 'editor', about: 'Oyun ekibi', members: 1, online: 1, icon: png('icon') },
    });
    // A code nobody made: the inviter's app answers, and knows no such invite.
    const forged = `RUMPUS1.${Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(code.slice(8), 'base64url').toString()),
        t: 'AAAAAAAAAAAAAAAAAAAAAA',
      }),
    ).toString('base64url')}`;
    expect(await arda.call<InviteCheck>('invites.check', { code: forged })).toMatchObject({
      reachable: true,
      invite: { state: 'expired' },
    });

    await arda.call('invites.join', { code });
    const request = await until(
      async () => (await kaan.call<WorkspaceState>('workspace.get')).joins?.[0],
      'join request',
    );
    // The code was used: it says so to whoever still holds it.
    expect((await kaan.call<InviteCheck>('invites.check', { code })).invite?.state).toBe('used');
    await kaan.call('invites.answer', { id: request.id, approve: true });
    await until(
      async () => (await arda.call<WorkspaceSummary[]>('workspaces.list')).find((w) => w.id === team.id && !w.state),
      'approved',
    );

    // Arda sees Kaan as Kaan presents himself, and the pictures come over from Kaan's computer.
    const aState = await until(async () => {
      const s = await arda.call<WorkspaceState>('workspaces.open', { id: team.id });
      return s.members?.find((m) => !m.me)?.profile?.avatar ? s : undefined;
    }, "kaan's profile at arda");
    expect(aState.members?.find((m) => !m.me)).toMatchObject({
      name: 'Kaan',
      profile: { bio: 'Oyun yapar.', status: 'derliyor', pronouns: 'o', color: '#3e9bdc', avatar },
    });
    expect(aState).toMatchObject({ about: 'Oyun ekibi', icon: looked.icon });
    await until(async () => {
      try {
        return (await arda.call<string>('blobs.get', { blob: avatar?.blob })) === png();
      } catch {
        return false;
      }
    }, "kaan's avatar at arda");
    await until(async () => {
      try {
        return (await arda.call<string>('blobs.get', { blob: looked.icon?.blob })) === png('icon');
      } catch {
        return false;
      }
    }, "the workspace's icon at arda");
    expect(arda.events('blob.added')).toContainEqual({ blob: avatar?.blob });
    expect((await arda.call<WorkspaceSummary[]>('workspaces.list')).find((w) => w.id === team.id)?.icon).toEqual(
      looked.icon,
    );
    await expect(arda.call('blobs.get', { blob: `${'0'.repeat(64)}.png` })).rejects.toThrow('not_found');

    // A new name in Arda's profile reaches Kaan; the name the member joined with is only the fallback.
    await arda.call('settings.update', { profile: { name: 'Arda B.', status: 'çizim' } });
    await until(async () => {
      const m = (await kaan.call<WorkspaceState>('workspace.get')).members?.find((x) => !x.me);
      return m?.name === 'Arda B.' && m.profile?.status === 'çizim';
    }, "arda's new name at kaan");

    // The look and the roles are the admins'.
    await expect(arda.call('workspace.look', { name: 'Benim' })).rejects.toThrow('not_allowed');
    await expect(arda.call('roles.save', { name: 'Patron' })).rejects.toThrow('not_allowed');
    await kaan.call('workspace.look', { name: 'Stüdyo' });
    await until(
      async () =>
        (await arda.call<WorkspaceSummary[]>('workspaces.list')).find((w) => w.id === team.id)?.name === 'Stüdyo',
      'the new name at arda',
    );
    expect((await arda.call<WorkspaceState>('workspace.get')).name).toBe('Stüdyo');

    await expect(kaan.call('roles.save', { name: '' })).rejects.toThrow('invalid_role');
    await expect(kaan.call('roles.save', { name: 'Tasarım', color: 'mor' })).rejects.toThrow('invalid_role');
    const design = await kaan.call<RoleTag>('roles.save', { name: 'Tasarım', color: '#ab4aba' });
    const code2 = await kaan.call<RoleTag>('roles.save', { name: 'Kod' });
    const ardaDevice = (await kaan.call<WorkspaceState>('workspace.get')).members?.find((m) => !m.me)?.device;
    await kaan.call('roles.assign', { device: ardaDevice, roles: [design.id, 'no-such-role', code2.id, design.id] });
    await expect(arda.call('roles.assign', { device: ardaDevice, roles: [] })).rejects.toThrow('not_allowed');
    const tagged = await until(async () => {
      const s = await arda.call<WorkspaceState>('workspace.get');
      return s.members?.find((m) => m.me)?.roles?.length === 2 ? s : undefined;
    }, 'roles at arda');
    expect(tagged.roles).toMatchObject([
      { id: design.id, name: 'Tasarım', color: '#ab4aba' },
      { id: code2.id, name: 'Kod', color: '' },
    ]);
    expect(tagged.members?.find((m) => m.me)?.roles).toEqual([design.id, code2.id]);
    // A role keeps its id when it is changed; a deleted one leaves the members that carried it.
    expect(await kaan.call<RoleTag>('roles.save', { id: design.id, name: 'Çizim', color: '#e93d82' })).toMatchObject({
      id: design.id,
      created: design.created,
    });
    await kaan.call('roles.delete', { id: code2.id });
    await until(async () => {
      const s = await arda.call<WorkspaceState>('workspace.get');
      return s.roles?.length === 1 && s.roles[0]?.name === 'Çizim' && s.members?.find((m) => m.me)?.roles?.length === 1;
    }, 'the changed roles at arda');

    // A picture taken away is gone from the profile others see.
    await kaan.call('profile.picture', { slot: 'avatar', data: null });
    await until(async () => {
      const m = (await arda.call<WorkspaceState>('workspace.get')).members?.find((x) => !x.me);
      return m?.profile && m.profile.avatar === null;
    }, 'the removed avatar at arda');
  }, 60_000);
});

describe('who may say what about whom', () => {
  it('a profile is its own device’s word; the look and the roles are an admin’s', async () => {
    const store = new WorkspaceStore(join(tmp('lonca-prof-mem-'), 'lonca.db'), 'X');
    const m = new Membership(store, 'w1');
    const root = new LocalSigner();
    const ed = new LocalSigner();
    const at = (n: number) => `${(Date.now() + n).toString(36).padStart(10, '0')}.0000.R`;
    const sign = async (signer: LocalSigner, e: Omit<SignedEvent, 'sig'>): Promise<SignedEvent> => ({
      ...e,
      sig: await signer.sign(eventPayload(e, 'w1')),
    });
    store.ingest(
      await sign(root, {
        id: 'g',
        author: 'R',
        n: 1,
        at: at(0),
        type: 'workspace.created',
        data: { id: 'w1', name: 'Ekip', root: 'R', publicKey: root.publicKey() },
      }),
    );
    for (const [n, device, signer, role] of [
      [2, 'R', root, 'admin'],
      [3, 'E', ed, 'editor'],
    ] as const) {
      store.ingest(
        await sign(root, {
          id: `c${n}`,
          author: 'R',
          n,
          at: at(n),
          type: 'member.certified',
          data: { device, publicKey: signer.publicKey(), name: device, role, expires: Date.now() + 1e9 },
        }),
      );
    }
    const by = (author: string, type: string, data: unknown) => ({
      id: `${type}-${author}`,
      author,
      n: 9,
      at: at(9),
      type,
      data,
    });
    expect(m.verify(await sign(ed, by('E', 'profile.saved', { device: 'E', name: 'Arda' })))).toBe('ok');
    expect(m.verify(await sign(ed, by('E', 'profile.saved', { device: 'R', name: 'Kaan değil' })))).toBe('not_allowed');
    expect(m.verify(await sign(ed, by('E', 'look.saved', { id: 'workspace', name: 'Benim', about: '' })))).toBe(
      'not_allowed',
    );
    expect(m.verify(await sign(ed, by('E', 'tag.saved', { id: 't', name: 'Patron', color: '', created: 1 })))).toBe(
      'not_allowed',
    );
    expect(m.verify(await sign(ed, by('E', 'tagged.saved', { device: 'E', tags: ['t'] })))).toBe('not_allowed');
    expect(m.verify(await sign(root, by('R', 'look.saved', { id: 'workspace', name: 'Stüdyo', about: '' })))).toBe(
      'ok',
    );
    expect(m.verify(await sign(root, by('R', 'look.saved', { id: 'other', name: 'Stüdyo', about: '' })))).toBe(
      'not_allowed',
    );
    expect(m.verify(await sign(root, by('R', 'tagged.saved', { device: 'E', tags: ['t'] })))).toBe('ok');

    // What arrives is checked again before it is kept: a profile with fields that are not what they claim.
    store.ingest(
      await sign(ed, {
        ...by('E', 'profile.saved', {
          device: 'E',
          name: 'A'.repeat(200),
          bio: 'b'.repeat(900),
          color: 'javascript:alert(1)',
          theme: ['#112233'],
          avatar: { blob: '../../x.png', mime: 'image/png' },
          banner: { blob: `${'a'.repeat(64)}.png`, mime: 'text/html' },
        }),
        n: 1,
      }),
    );
    const kept = store.profile('E');
    expect(kept?.name).toHaveLength(LIMITS.personName);
    expect(kept?.bio).toHaveLength(LIMITS.bio);
    expect(kept).toMatchObject({ color: '', theme: [], avatar: null, banner: null });

    // A message from another computer is held to the length this one's own may have.
    store.ingest(
      await sign(ed, {
        ...by('E', 'message.posted', {
          id: 'big',
          channelId: 'c',
          author: { kind: 'person', id: 'E', name: 'Arda' },
          text: 'x'.repeat(LIMITS.message + 5000),
          created: 1,
        }),
        id: 'm-big',
        n: 2,
      }),
    );
    expect(store.message('big')?.text).toHaveLength(LIMITS.message);
  });
});
