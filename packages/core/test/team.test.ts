import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  Agent,
  Channel,
  Frame,
  InviteCheck,
  Job,
  Message,
  ProjectView,
  Response,
  WorkspaceState,
  WorkspaceSummary,
} from '@lonca/protocol';
import { afterAll, describe, expect, it } from 'vitest';
import type { AgentSession, DriverEvent, OpenSession } from '../src/drivers/types.js';
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
  // A fake Claude Code: found on PATH, signed in, and a session that records what it is sent.
  const bin = tmp('lonca-team-bin-');
  writeFileSync(join(bin, 'claude'), '');
  const sessions: {
    emit: (e: DriverEvent) => void;
    sent: string[];
    mode: string;
    mcp?: { url: string; token: string };
  }[] = [];
  const open: OpenSession = (o, emit) => {
    const s = { emit, sent: [] as string[], mode: o.mode, ...(o.mcp ? { mcp: o.mcp } : {}) };
    sessions.push(s);
    const session: AgentSession = {
      steering: 'live',
      busy: false,
      send: (t) => s.sent.push(t),
      stop: () => {},
      dispose: () => {},
    };
    return session;
  };
  const core = new Core({
    appDir: tmp('lonca-team-'),
    language: 'tr',
    env: { PATH: bin },
    platform: 'linux',
    runner: async (_f, args) =>
      args[0] === '--version'
        ? { code: 0, stdout: '2.1.0', stderr: '', timedOut: false }
        : args[0] === 'auth'
          ? {
              code: 0,
              stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }),
              stderr: '',
              timedOut: false,
            }
          : { code: 1, stdout: '', stderr: '', timedOut: false, failed: true },
    drivers: { 'claude-code': open },
    launch: (path) => ({ file: path, args: [] }),
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
  return { core, call, name, sessions, events };
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
    expect(code.startsWith('RUMPUS1.')).toBe(true);
    await expect(arda.call('invites.join', { code: 'LONCA1.bozuk' })).rejects.toThrow('bad_code');
    // Before asking: the invite says which workspace it is for and whether the inviter's app answers. The same
    // code is read from an invite link and with the product's former prefixes and link schemes.
    const { link } = await kaan.call<{ link: string }>('invites.create', { role: 'viewer' });
    expect(link).toMatch(/^rumpus:\/\/join\/RUMPUS1\./);
    for (const pasted of [
      code,
      `rumpus://join/${code}`,
      ` ${code.replace('RUMPUS1.', 'LONCA1.')}\n`,
      code.replace('RUMPUS1.', 'SERAI1.'),
      `serai://join/${code.replace('RUMPUS1.', 'SERAI1.')}`,
    ]) {
      expect(await arda.call<InviteCheck>('invites.check', { code: pasted })).toMatchObject({
        name: 'Ekip',
        reachable: true,
        joined: false,
      });
    }
    await expect(arda.call('invites.check', { code: 'rumpus://join/bozuk' })).rejects.toThrow('bad_code');
    const joining = await arda.call<WorkspaceSummary>('invites.join', { code });
    expect((await arda.call<InviteCheck>('invites.check', { code })).joined).toBe(true);
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

    // Typing travels live, without being stored.
    await arda.call('channels.typing', { channelId: genel });
    await until(async () => kaan.events('person.typing').length > 0, 'kaan hears arda typing', 5000);
    expect(kaan.events('person.typing')[0]).toMatchObject({ channelId: genel, name: 'Arda' });

    // /durum: Kaan's computer answers at once, Arda's answers over the live link.
    const [own] = await kaan.call<{ me: boolean; name: string }[]>('status.get');
    expect(own).toMatchObject({ me: true, name: 'Kaan' });
    await until(async () => kaan.events('status.changed').length > 0, 'arda answers /durum', 5000);
    expect(kaan.events('status.changed')[0]).toMatchObject({
      name: 'Arda',
      me: false,
      clis: [{ kind: 'claude-code', state: 'ready' }],
    });

    // Kaan's agent, open to editors at read level: Arda's mention runs it on Kaan's computer, capped at read.
    const agent = await kaan.call<Agent>('agents.save', {
      kind: 'claude-code',
      name: 'Claude',
      handle: 'claude',
      folder: tmp('lonca-team-proj-'),
      mode: 'edit',
      access: { who: 'members', maxMode: 'read', approveOthers: false },
    });
    await until(
      async () => (await arda.call<WorkspaceState>('workspace.get')).agents.some((a) => a.id === agent.id),
      'arda sees the agent',
    );
    await expect(arda.call('agents.save', { ...agent, name: 'Benim' })).rejects.toThrow('not_allowed');
    await arda.call('messages.send', { channelId: genel, text: '@claude README ne anlatıyor?' });
    const session = await until(
      async () => kaan.sessions.find((x) => x.sent.some((t) => t.includes('README ne anlatıyor'))),
      'kaan runs it',
    );
    expect(session.mode).toBe('read');
    expect(arda.sessions).toHaveLength(0);
    session.emit({ type: 'end', ok: true, final: 'README bir bütçe uygulaması anlatıyor.' });
    await until(async () => {
      const page = await arda.call<{ messages: Message[]; jobs: Job[] }>('messages.list', { channelId: genel });
      const answered = page.messages.some((m) => m.author.kind === 'agent' && m.text.startsWith('README bir bütçe'));
      return answered && page.jobs.some((j) => j.agentId === agent.id && j.state === 'done');
    }, 'arda sees the answer and the finished job');

    // With "approve others' jobs first", the job waits on Kaan.
    await kaan.call('agents.save', { ...agent, access: { who: 'members', maxMode: 'read', approveOthers: true } });
    await until(
      async () => (await arda.call<WorkspaceState>('workspace.get')).agents.some((a) => a.access?.approveOthers),
      'new access synced',
    );
    const before = kaan.sessions.length;
    await arda.call('messages.send', { channelId: genel, text: '@claude testleri çalıştır' });
    const held = await until(async () => {
      const page = await kaan.call<{ jobs: Job[] }>('messages.list', { channelId: genel });
      return page.jobs.find((j) => j.state === 'attention' && j.approval?.id === 'start');
    }, 'job waits for the owner');
    expect(held.approval?.arg).toBe('Arda');
    await kaan.call('jobs.answer', { id: held.id, allow: true });
    await until(
      async () =>
        kaan.sessions.slice(before).some((x) => x.sent.some((t) => t.includes('testleri çalıştır'))) ||
        kaan.sessions.some((x) => x.sent.some((t) => t.includes('testleri çalıştır'))),
      'approved job runs',
    );

    // Kaan's agent hands a part of Kaan's request to Arda's agent: it runs on Arda's computer as Kaan's request,
    // under Arda's limits, and the answer comes back to Kaan's agent.
    const ardaAgent = await arda.call<Agent>('agents.save', {
      kind: 'claude-code',
      name: 'Yardımcı',
      handle: 'yardimci',
      folder: tmp('lonca-team-aproj-'),
      mode: 'edit',
      access: { who: 'members', maxMode: 'read', approveOthers: false },
    });
    await until(
      async () => (await kaan.call<WorkspaceState>('workspace.get')).agents.some((a) => a.id === ardaAgent.id),
      'kaan sees arda agent',
    );
    // The approved job ends first: a message to a busy agent would steer that job (Arda's request) instead.
    kaan.sessions
      .find((x) => x.sent.some((t) => t.includes('testleri çalıştır')))
      ?.emit({ type: 'end', ok: true, final: 'Testler geçti.' });
    await until(async () => {
      const page = await kaan.call<{ jobs: Job[] }>('messages.list', { channelId: genel });
      return page.jobs.every((j) => j.state !== 'running');
    }, 'no job running');
    await kaan.call('messages.send', { channelId: genel, text: '@claude işi böl' });
    const splitter = await until(
      async () => kaan.sessions.find((x) => x.sent.some((t) => t.includes('işi böl'))),
      'kaan agent works',
    );
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await fetch(splitter.mcp?.url ?? '', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${splitter.mcp?.token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      });
      return ((await r.json()) as { result: { content: { text: string }[] } }).result.content[0]?.text ?? '';
    };
    // Kaan's job must be visible to Arda before the part can be checked there.
    await until(async () => {
      const page = await arda.call<{ jobs: Job[] }>('messages.list', { channelId: genel });
      return page.jobs.some((j) => j.agentId === agent.id && j.state === 'running');
    }, 'arda sees the running job');
    const handed = await call('hand_over', { agent: 'yardimci', task: 'Arayüz metinlerini kontrol et.' });
    const partId = /part (\S+?)\./.exec(handed)?.[1] ?? '';
    expect(partId).not.toBe('');
    const helper = await until(
      async () => arda.sessions.find((x) => x.sent.some((t) => t.includes('Arayüz metinlerini kontrol et.'))),
      'arda runs the part',
    );
    expect(helper.mode).toBe('read');
    helper.emit({ type: 'end', ok: true, final: 'Metinler tutarlı.' });
    await until(
      async () => (await call('part_status', { id: partId })).includes('Metinler tutarlı.'),
      'the answer comes back to kaan agent',
    );
    splitter.emit({ type: 'end', ok: true, final: 'Bölündü.' });

    // Arda asks Kaan's agent, which hands a part back to Arda's agent: the part is Arda's request, but it never gets
    // more than Kaan (the handing agent's owner) could ask of Arda's agent, so it stays at read.
    await kaan.call('agents.save', { ...agent, access: { who: 'members', maxMode: 'read', approveOthers: false } });
    await until(
      async () =>
        (await arda.call<WorkspaceState>('workspace.get')).agents.some(
          (a) => a.id === agent.id && a.access?.approveOthers === false && a.access.who === 'members',
        ),
      'open access synced',
    );
    await until(async () => {
      const page = await kaan.call<{ jobs: Job[] }>('messages.list', { channelId: genel });
      return page.jobs.every((j) => j.state !== 'running');
    }, 'kaan agent idle');
    await arda.call('messages.send', { channelId: genel, text: '@claude ikinci bölme' });
    const second = await until(
      async () => kaan.sessions.find((x) => x.sent.some((t) => t.includes('ikinci bölme'))),
      'kaan agent works for arda',
    );
    await until(async () => {
      const page = await arda.call<{ jobs: Job[] }>('messages.list', { channelId: genel });
      return page.jobs.some((j) => j.agentId === agent.id && j.state === 'running');
    }, 'arda sees the job running');
    const tool2 = async (name: string, args: Record<string, unknown>) => {
      const r = await fetch(second.mcp?.url ?? '', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${second.mcp?.token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      });
      return ((await r.json()) as { result: { content: { text: string }[] } }).result.content[0]?.text ?? '';
    };
    expect(await tool2('hand_over', { agent: 'yardimci', task: 'Kenar durumlarını yaz.' })).toMatch(/^Handed over/);
    const capped = await until(
      async () => arda.sessions.find((x) => x.sent.some((t) => t.includes('Kenar durumlarını yaz.'))),
      'arda runs the second part',
    );
    expect(capped.mode).toBe('read');
    capped.emit({ type: 'end', ok: true, final: 'Yazıldı.' });
    second.emit({ type: 'end', ok: true, final: 'Tamam.' });

    // Only the owner: Arda's call does nothing.
    await kaan.call('agents.save', { ...agent, access: { who: 'me', maxMode: 'read', approveOthers: false } });
    await until(
      async () => (await arda.call<WorkspaceState>('workspace.get')).agents.some((a) => a.access?.who === 'me'),
      'closed access synced',
    );
    await arda.call('messages.send', { channelId: genel, text: '@claude gizli iş' });
    await new Promise((r) => setTimeout(r, 1500));
    expect(kaan.sessions.some((x) => x.sent.some((t) => t.includes('gizli iş')))).toBe(false);

    // A project syncs without Kaan's folder; Arda points it at her own clone and edits the status page.
    const ardaDevice0 = aState.members?.find((m) => m.me)?.device ?? '';
    const project = await kaan.call<ProjectView>('projects.save', {
      name: 'Kumbara',
      areas: [{ path: 'src/ui', member: ardaDevice0, note: 'arayüz' }],
      folder: tmp('lonca-team-kclone-'),
    });
    const synced = await until(async () => {
      const list = await arda.call<ProjectView[]>('projects.list');
      return list.find((p) => p.id === project.id);
    }, 'arda sees the project');
    expect(synced.folder).toBeUndefined();
    expect(synced.areas[0]?.member).toBe(ardaDevice0);
    const ardaClone = tmp('lonca-team-aclone-');
    expect((await arda.call<ProjectView>('projects.save', { ...synced, folder: ardaClone })).folder).toBe(ardaClone);
    await arda.call('projects.status', { id: project.id, next: ['Giriş ekranı'] });
    await until(async () => {
      const [p] = await kaan.call<ProjectView[]>('projects.list');
      return p?.status.next[0] === 'Giriş ekranı' && p.status.by === 'Arda' && p.folder !== ardaClone;
    }, 'kaan sees arda edit the page, keeping his own folder');

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
