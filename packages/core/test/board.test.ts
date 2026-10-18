import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Card, Frame, Message, RecordItem, Response, WorkspaceState, WorkspaceSummary } from '@lonca/protocol';
import { describe, expect, it } from 'vitest';
import type { AgentSession, DriverEvent, OpenSession } from '../src/drivers/types.js';
import { Core } from '../src/server.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

function setup() {
  const bin = tmp('lonca-bin-');
  writeFileSync(join(bin, 'claude'), '');
  const sessions: { emit: (e: DriverEvent) => void; sent: string[]; images: number[] }[] = [];
  const open: OpenSession = (_o, emit) => {
    const s = { emit, sent: [] as string[], images: [] as number[] };
    sessions.push(s);
    const session: AgentSession = {
      steering: 'live',
      busy: false,
      send: (t, images) => {
        s.sent.push(t);
        s.images.push(images?.length ?? 0);
      },
      stop: () => {},
      dispose: () => {},
    };
    return session;
  };
  const core = new Core({
    appDir: tmp('lonca-app-'),
    language: 'tr',
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
  const sent: Frame[] = [];
  core.attach({ send: (f) => sent.push(f), onFrame: (l) => (listener = l) });
  let id = 0;
  const call = async <T>(method: string, params?: unknown): Promise<T> => {
    const rid = ++id;
    listener({ id: rid, method, params });
    for (let i = 0; i < 400; i++) {
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

describe('board', () => {
  it('creates a card for an agent, runs it as a job, and moves it with the job', async () => {
    const { call, sessions } = setup();
    const folder = tmp('lonca-proj-');
    await call('agents.save', { kind: 'claude-code', name: 'Claude', handle: 'claude', folder, mode: 'read' });
    const card = await call<Card>('cards.create', { title: 'README yaz', agentHandle: 'claude' });
    expect(card).toMatchObject({ status: 'todo', assignee: { kind: 'agent' } });

    const running = await call<Card>('cards.run', { id: card.id });
    expect(running.status).toBe('doing');
    expect(running.jobId).toBeTruthy();
    expect(sessions[0]?.sent[0]).toContain('@claude README yaz');

    sessions[0]?.emit({ type: 'end', ok: true, final: 'Yazıldı.' });
    await new Promise((r) => setTimeout(r, 50));
    const [after] = await call<Card[]>('cards.list');
    expect(after).toMatchObject({ status: 'review', jobId: running.jobId });
  });

  it('edits, moves and deletes cards, and refuses bad input', async () => {
    const { call } = setup();
    const card = await call<Card>('cards.create', { title: 'Tasarım' });
    expect(await call<Card>('cards.update', { id: card.id, status: 'done', title: 'Tasarım v2' })).toMatchObject({
      status: 'done',
      title: 'Tasarım v2',
    });
    await expect(call('cards.update', { id: card.id, status: 'nope' })).rejects.toThrow('bad_request');
    await expect(call('cards.create', { title: '   ' })).rejects.toThrow('bad_request');
    await expect(call('cards.create', { title: 'x', agentHandle: 'yok' })).rejects.toThrow('not_found');
    await expect(call('cards.run', { id: card.id })).rejects.toThrow('not_found');
    await call('cards.delete', { id: card.id });
    expect(await call<Card[]>('cards.list')).toEqual([]);
  });
});

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('records', () => {
  it('saves ideas and references, and gives a job the references of its request', async () => {
    const { call, sessions } = setup();
    const idea = await call<RecordItem>('records.save', {
      kind: 'idea',
      title: 'Karanlık mod',
      body: 'Gece için',
      tags: ['UI', 'ui'],
    });
    expect(idea).toMatchObject({ kind: 'idea', status: 'new', tags: ['ui'] });
    const ref = await call<RecordItem>('records.save', {
      kind: 'reference',
      title: 'Ödeme ekranı',
      imageData: PNG,
      width: 1,
      height: 1,
    });
    expect(ref.image).toMatchObject({ mime: 'image/png', width: 1 });
    expect(await call<string>('records.image', { id: ref.id })).toBe(PNG);
    await expect(call('records.save', { kind: 'reference', title: 'boş' })).rejects.toThrow('bad_request');
    await expect(
      call('records.save', { kind: 'reference', title: 'x', imageData: 'data:text/html;base64,PGI+' }),
    ).rejects.toThrow('bad_request');
    expect((await call<RecordItem[]>('records.list', { kind: 'idea' })).map((r) => r.id)).toEqual([idea.id]);

    const folder = tmp('lonca-proj-');
    await call('agents.save', { kind: 'claude-code', name: 'Claude', handle: 'claude', folder, mode: 'read' });
    const { channels } = await call<{ channels: { id: string; kind: string }[] }>('workspace.get');
    const general = channels.find((c) => c.kind === 'channel');
    await call('messages.send', { channelId: general?.id, text: '@claude buna göre yap', refs: [ref.id, idea.id] });
    await new Promise((r) => setTimeout(r, 50));
    expect(sessions[0]?.sent[0]).toMatch(
      /<references>\n- reference "Ödeme ekranı" \(image attached\)\n- idea "Karanlık mod": Gece için\n<\/references>$/,
    );
    expect(sessions[0]?.images[0]).toBe(1);
    await expect(call('messages.send', { channelId: general?.id, text: 'x', refs: ['nope'] })).rejects.toThrow(
      'bad_request',
    );
  });
});

describe('instructions', () => {
  it('edits the worker template and workspace layer, previews the whole prompt, resets', async () => {
    const { call } = setup();
    type Layers = { core: string; worker: { text: string; isDefault: boolean }; workspace: string };
    const start = await call<Layers>('instructions.get');
    expect(start.worker.isDefault).toBe(true);
    expect(start.core).toContain('channel_context');

    await call('instructions.save', { layer: 'worker', text: 'Always answer in haiku, {user}.' });
    await call('instructions.save', { layer: 'workspace', text: 'The project is a Roblox game.' });
    const folder = tmp('lonca-proj-');
    const agent = await call<{ id: string }>('agents.save', {
      kind: 'claude-code',
      name: 'Claude',
      handle: 'claude',
      folder,
      mode: 'edit',
      instructions: 'Never touch {folder}/secrets.',
    });
    const preview = await call<string>('instructions.preview', { agentId: agent.id });
    const order = [
      'Rules Lonca enforces',
      'Always answer in haiku, Lonca.',
      'The project is a Roblox game.',
      `Never touch ${folder}/secrets.`,
    ];
    const positions = order.map((part) => preview.indexOf(part));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    const reset = await call<Layers>('instructions.reset', { layer: 'worker' });
    expect(reset.worker.isDefault).toBe(true);
    expect(reset.workspace).toBe('The project is a Roblox game.');
    await expect(call('instructions.save', { layer: 'core', text: 'x' })).rejects.toThrow('bad_request');
  });
});

describe('workspaces', () => {
  it('keeps workspaces apart, and lets a background job finish without reaching the window', async () => {
    const { call, sessions, sent } = setup();
    const folder = tmp('lonca-proj-');
    const personal = await call<WorkspaceState>('workspace.get');
    expect(personal).toMatchObject({ id: 'personal', kind: 'personal' });
    await call('agents.save', { kind: 'claude-code', name: 'Claude', handle: 'claude', folder, mode: 'read' });
    const genel = personal.channels[0]?.id ?? '';
    await call('messages.send', { channelId: genel, text: '@claude README?' });
    await new Promise((r) => setTimeout(r, 30));
    expect(sessions).toHaveLength(1);

    const team = await call<WorkspaceSummary>('workspaces.create', { name: 'Ekip' });
    expect(await call<WorkspaceSummary[]>('workspaces.list')).toMatchObject([
      { id: 'personal' },
      { id: team.id, name: 'Ekip', kind: 'team' },
    ]);
    const teamState = await call<WorkspaceState>('workspace.get');
    expect(teamState).toMatchObject({ id: team.id, name: 'Ekip', kind: 'team', agents: [] });
    expect(teamState.channels[0]?.id).not.toBe(genel);

    // The personal workspace's job ends while the team one is open: nothing about it reaches the window.
    const before = sent.length;
    sessions[0]?.emit({ type: 'end', ok: true, final: 'README bir proje anlatıyor.' });
    await new Promise((r) => setTimeout(r, 50));
    const leaked = sent.slice(before).filter((f) => 'event' in f && ['message.added', 'job.updated'].includes(f.event));
    expect(leaked).toEqual([]);

    await call('workspaces.open', { id: 'personal' });
    const page = await call<{ messages: Message[] }>('messages.list', { channelId: genel });
    expect(page.messages.map((m) => m.text)).toContain('README bir proje anlatıyor.');
    await expect(call('workspaces.open', { id: 'nope' })).rejects.toThrow('not_found');
    await expect(call('workspaces.create', { name: '  ' })).rejects.toThrow('bad_request');
  });
});
