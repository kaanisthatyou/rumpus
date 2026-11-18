// Reports (PLAN.md 5.21): the workspace's report feed, on the board's Reports page. People do not write there,
// routines and agents do; an agent attaches images, leaves questions and posts reports; a person reads, pins and
// answers a report with it attached; what an agent writes between tool calls is posted.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Channel,
  type Frame,
  type Message,
  REPORTS_CHANNEL,
  type ReportMark,
  type Response,
  type Routine,
  reportCode,
  reportTitle,
  type WorkspaceState,
} from '@lonca/protocol';
import { describe, expect, it } from 'vitest';
import type { AgentSession, Attachment, DriverEvent, OpenSession, SessionOptions } from '../src/drivers/types.js';
import { Core } from '../src/server.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

interface Fake {
  opts: SessionOptions;
  emit: (e: DriverEvent) => void;
  sent: { text: string; images: Attachment[] }[];
}

function setup() {
  const bin = tmp('lonca-bin-');
  writeFileSync(join(bin, 'claude'), '');
  const sessions: Fake[] = [];
  const open: OpenSession = (opts, emit) => {
    const s: Fake = { opts, emit, sent: [] };
    sessions.push(s);
    const session: AgentSession = {
      steering: 'live',
      busy: false,
      send: (text, images = []) => s.sent.push({ text, images }),
      stop: () => {},
      dispose: () => {},
    };
    return session;
  };
  const core = new Core({
    appDir: tmp('lonca-rep-'),
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
  const frames: Frame[] = [];
  core.attach({ send: (f) => frames.push(f), onFrame: (l) => (listener = l) });
  let id = 0;
  const call = async <T>(method: string, params?: unknown): Promise<T> => {
    const rid = ++id;
    listener({ id: rid, method, params });
    for (let i = 0; i < 400; i++) {
      const r = frames.find((f) => 'id' in f && f.id === rid && ('result' in f || 'error' in f)) as
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
  return { call, sessions };
}

async function until<T>(get: () => T | undefined): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const v = get();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timed out');
}

function toolOf(session: Fake) {
  const mcp = session.opts.mcp;
  return async (name: string, args: Record<string, unknown>): Promise<string> => {
    const res = await fetch(mcp?.url ?? '', {
      method: 'POST',
      headers: { authorization: `Bearer ${mcp?.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const json = (await res.json()) as { result?: { content?: { text?: string }[] } };
    return (json.result?.content ?? []).map((c) => c.text ?? '').join('\n');
  };
}

describe('reports', () => {
  it('takes routines and agents only, carries images, and hands a cited report to the next job', async () => {
    const { call, sessions } = setup();
    const folder = tmp('lonca-proj-');
    writeFileSync(join(folder, 'shot.png'), PNG);
    writeFileSync(join(folder, 'notes.txt'), 'not an image');
    await call('agents.save', { kind: 'claude-code', name: 'Nora', handle: 'nora', folder, mode: 'read' });

    // The feed is made once, under the same id, and is not among the channels to open.
    const reports = await call<Channel>('reports.channel');
    expect(reports).toMatchObject({ id: REPORTS_CHANNEL, reports: true });
    expect((await call<Channel>('reports.channel')).id).toBe(REPORTS_CHANNEL);
    let ws = await call<WorkspaceState>('workspace.get');
    expect(ws.channels.some((c) => c.id === reports.id)).toBe(false);
    expect(ws.reportChannels).toEqual([REPORTS_CHANNEL]);
    // A person does not write there.
    await expect(call('messages.send', { channelId: reports.id, text: '@nora merhaba' })).rejects.toThrow(
      'reports_only',
    );

    // A routine does, and the agent is told its answer is a report.
    const routine = await call<Routine>('routines.save', {
      channelId: reports.id,
      text: '@nora sabah kontrolü',
      at: '08:30',
    });
    await call('routines.run', { id: routine.id });
    const nora = await until(() => sessions[0]?.sent[0] && sessions[0]);
    expect(nora.sent[0]?.text).toContain("This is the workspace's reports");
    const tool = toolOf(nora);

    // Images: only image files, attached to the answer.
    expect(await tool('attach_image', { path: 'notes.txt' })).toMatch(/^Not an image/);
    expect(await tool('attach_image', { path: 'yok.png' })).toMatch(/^No such file/);
    expect(await tool('attach_image', { path: 'shot.png', caption: 'Ana ekran' })).toMatch(/^Attached/);
    // A question left to the person, on the answer.
    expect(await tool('ask_decision', { question: '' })).toMatch(/^A question is needed/);
    expect(await tool('ask_decision', { question: 'Yayınlayayım mı?', options: ['Evet', 'Hayır', ''] })).toMatch(
      /^Added/,
    );
    // A report of its own, with an image by an absolute path.
    const posted = await tool('post_report', {
      title: 'Gece taraması',
      body: 'İki uyarı var.',
      images: [{ path: join(folder, 'shot.png') }],
      decisions: [{ question: 'Hangisi önce?', options: ['A', 'B'] }, { question: '' }],
    });
    expect(posted).toMatch(/^Posted report #[0-9A-Z]{6} with 1 image and 1 decision\.$/);

    // What it writes before a tool call is posted at once; the answer ends the job with the image.
    nora.emit({ type: 'text', text: 'Testlere bakıyorum.' });
    nora.emit({ type: 'tool', id: 't1', label: 'run', arg: 'pnpm test' });
    nora.emit({ type: 'tool_result', id: 't1', ok: true, preview: 'ok' });
    nora.emit({ type: 'text', text: '# Sabah raporu\nHer şey yolunda.' });
    nora.emit({ type: 'end', ok: true, final: '# Sabah raporu\nHer şey yolunda.' });

    let list: { messages: Message[] } = { messages: [] };
    for (let i = 0; i < 100; i++) {
      list = await call<{ messages: Message[] }>('messages.list', { channelId: reports.id });
      if (list.messages.some((m) => m.jobId)) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const note = list.messages.find((m) => m.during);
    const answer = list.messages.find((m) => m.jobId);
    const own = list.messages.find((m) => m.title === 'Gece taraması');
    expect(note?.text).toBe('Testlere bakıyorum.');
    expect(note?.during).toBe(answer?.jobId);
    expect(answer?.images).toEqual([
      expect.objectContaining({ mime: 'image/png', caption: 'Ana ekran', width: 1, height: 1 }),
    ]);
    expect(own?.images?.length).toBe(1);
    expect(own?.decisions).toEqual([{ question: 'Hangisi önce?', options: ['A', 'B'] }]);
    expect(answer?.decisions).toEqual([{ question: 'Yayınlayayım mı?', options: ['Evet', 'Hayır'] }]);

    // Two reports, both unread; read and pinned marks are kept, and all of them can be read at once.
    ws = await call<WorkspaceState>('workspace.get');
    expect(ws.reportsUnread).toBe(2);
    const feed = await call<{ channel?: string; messages: Message[]; marks: Record<string, ReportMark> }>(
      'reports.list',
    );
    expect(feed.channel).toBe(REPORTS_CHANNEL);
    expect(feed.messages.map((m) => m.id)).toEqual(list.messages.map((m) => m.id));
    await call('reports.mark', { ids: [answer?.id], read: true, pinned: true });
    await call('reports.mark', { ids: [answer?.id], pinned: false });
    expect((await call<WorkspaceState>('workspace.get')).reportsUnread).toBe(1);
    const marks = (await call<{ marks: Record<string, ReportMark> }>('reports.list')).marks;
    expect(marks[answer?.id ?? '']).toEqual({ read: true });
    await call('reports.mark', {});
    expect((await call<WorkspaceState>('workspace.get')).reportsUnread).toBe(0);
    expect(reportTitle(answer as Message)).toBe('Sabah raporu');
    const image = await call<string>('messages.image', { id: answer?.id, blob: answer?.images?.[0]?.blob });
    expect(image.startsWith('data:image/png;base64,')).toBe(true);

    // The report opened by id: its job, the routine's message, the note.
    const got = await call<{ message: Message; request?: Message; notes?: Message[] }>('messages.get', {
      id: answer?.id,
    });
    expect(got.request?.routine).toBe(routine.id);
    expect(got.notes?.map((n) => n.text)).toEqual(['Testlere bakıyorum.']);

    // Answering it in the agent's own channel: the message carries the report, the job gets its text and image.
    ws = await call<WorkspaceState>('workspace.get');
    const dm = ws.channels.find((c) => c.kind === 'agent') as Channel;
    await expect(call('messages.send', { channelId: dm.id, text: 'x', cite: 'yok' })).rejects.toThrow('bad_request');
    const reply = await call<Message>('messages.send', {
      channelId: dm.id,
      text: 'Uyarıları düzelt',
      cite: answer?.id,
    });
    expect(reply.cite).toMatchObject({ id: answer?.id, title: 'Sabah raporu', by: 'Nora', channelId: reports.id });
    const second = await until(() => sessions.find((s) => s.sent.some((x) => x.text.includes('Uyarıları düzelt'))));
    const turn = second.sent.find((x) => x.text.includes('Uyarıları düzelt'));
    expect(turn?.text).toContain(`<report id="#${reportCode(answer?.id ?? '')}"`);
    expect(turn?.text).toContain('Her şey yolunda.');
    expect(turn?.images.length).toBe(1);

    // The overview counts the week: one job, done.
    const overview = await call<{ week: { done: number; jobs: number }; agents: { name: string }[] }>('overview.get');
    expect(overview.week).toMatchObject({ done: 1 });
    expect(overview.agents[0]?.name).toBe('Nora');
  });

  it('lets a note give way to the answer when the job ends on a tool call', async () => {
    const { call, sessions } = setup();
    const folder = tmp('lonca-proj-');
    await call('agents.save', { kind: 'claude-code', name: 'Nora', handle: 'nora', folder, mode: 'read' });
    const ws = await call<WorkspaceState>('workspace.get');
    const genel = (ws.channels.find((c) => c.kind === 'channel') as Channel).id;
    await call('messages.send', { channelId: genel, text: '@nora bak' });
    const nora = await until(() => sessions[0]?.sent[0] && sessions[0]);
    nora.emit({ type: 'text', text: 'Bitti, dosyayı yazdım.' });
    nora.emit({ type: 'tool', id: 't1', label: 'write', arg: 'a.txt' });
    nora.emit({ type: 'end', ok: true, final: 'Bitti, dosyayı yazdım.' });
    let messages: Message[] = [];
    for (let i = 0; i < 100; i++) {
      messages = (await call<{ messages: Message[] }>('messages.list', { channelId: genel })).messages;
      if (messages.some((m) => m.jobId)) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const agents = messages.filter((m) => m.author.kind === 'agent');
    expect(agents.map((m) => [m.text, Boolean(m.jobId)])).toEqual([['Bitti, dosyayı yazdım.', true]]);
  });
});
