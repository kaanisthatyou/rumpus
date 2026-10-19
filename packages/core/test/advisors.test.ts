import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Advisor, Channel, Frame, Job, LlmRequest, Message, Response } from '@lonca/protocol';
import { describe, expect, it } from 'vitest';
import { Advisors, type AdvisorsDeps, inQuietHours, MAX_BOT_STREAK } from '../src/advisors.js';
import { type Llm, LlmError } from '../src/llm.js';
import { Core } from '../src/server.js';
import { WorkspaceStore } from '../src/store.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const NOON = new Date(2026, 9, 18, 12, 0).getTime();

/** A provider stand-in: `reply` decides the text per request. */
function fakeLlm(reply: (req: LlmRequest) => string | Error) {
  const requests: LlmRequest[] = [];
  const llm: Llm = {
    state: () => ({
      providers: [
        { id: 'p1', preset: 'groq', name: 'Groq', baseUrl: 'https://x', wire: 'openai', keys: [], models: [] },
      ],
      protection: 'os',
    }),
    onChange: () => {},
    complete: async (req) => {
      requests.push(req);
      const r = reply(req);
      if (r instanceof Error) throw r;
      return { text: r, usage: { in: 100, out: 20 } };
    },
  };
  return { llm, requests };
}

const advisor = (over: Partial<Advisor> = {}): Advisor => ({
  id: 'a1',
  name: 'Eleştirmen',
  handle: 'elestirmen',
  personality: 'critical',
  prompt: 'Be critical.',
  providerId: 'p1',
  model: 'm',
  channels: [],
  chatter: 'normal',
  dailyTokens: 10_000,
  owner: 'dev',
  created: 1,
  ...over,
});

function setup(reply: (req: LlmRequest) => string | Error, opts: { now?: number; random?: number } = {}) {
  const store = new WorkspaceStore(join(tmp('lonca-adv-'), 'lonca.db'), 'dev');
  const channel: Channel = { id: 'c1', name: 'genel', kind: 'channel', topic: '', created: 1 };
  store.commit({ type: 'channel.created', data: channel });
  const { llm, requests } = fakeLlm(reply);
  const events = { typing: [] as boolean[], failed: [] as string[], cards: [] as string[], messages: [] as Message[] };
  let now = opts.now ?? NOON;
  const deps: AdvisorsDeps = {
    store,
    llm,
    deviceId: 'dev',
    me: () => ({ id: 'dev', name: 'Kaan', language: 'tr' }),
    quietHours: () => ({ from: '23:00', to: '08:00' }),
    emitMessage: (m) => events.messages.push(m),
    emitTyping: (e) => events.typing.push(e.on),
    emitSpend: () => {},
    emitFailed: (e) => events.failed.push(e.code),
    addCard: (title) => events.cards.push(title),
    project: async () => 'Recent commits:\nabc123 2026-10-18 Kaan: add login',
    now: () => now,
    random: () => opts.random ?? 0,
  };
  const advisors = new Advisors(deps);
  const post = (text: string, author: Message['author'] = { kind: 'person', id: 'dev', name: 'Kaan' }) => {
    now += 1000;
    const m: Message = { id: `m${now}`, channelId: 'c1', author, text, created: now };
    store.commit({ type: 'message.posted', data: m });
    return m;
  };
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
  };
  return {
    store,
    channel,
    advisors,
    requests,
    events,
    post,
    settle,
    setNow: (t: number) => {
      now = t;
    },
  };
}

describe('quiet hours', () => {
  it('handles ranges across midnight and turns off with equal times', () => {
    const at = (h: number, m = 0) => new Date(2026, 9, 18, h, m);
    const q = { from: '23:00', to: '08:00' };
    expect(inQuietHours(at(23, 30), q)).toBe(true);
    expect(inQuietHours(at(3), q)).toBe(true);
    expect(inQuietHours(at(8), q)).toBe(false);
    expect(inQuietHours(at(12), q)).toBe(false);
    expect(inQuietHours(at(13), { from: '12:00', to: '14:00' })).toBe(true);
    expect(inQuietHours(at(3), { from: '00:00', to: '00:00' })).toBe(false);
  });
});

describe('Advisors', () => {
  it('answers a mention with the project, board and channel in the prompt, counts tokens, and turns /todo into a card', async () => {
    const t = setup(() => 'Login akışında hata durumu yok.\n/todo Login hatalarını göster');
    t.store.commit({ type: 'advisor.saved', data: advisor({ folder: '/work' }) });
    const m = t.post('@elestirmen bu ne durumda?');
    t.advisors.onMessage(m, t.channel);
    await t.settle();
    expect(t.events.messages).toHaveLength(1);
    expect(t.events.messages[0]?.author).toEqual({ kind: 'advisor', id: 'a1', name: 'Eleştirmen' });
    expect(t.events.cards).toEqual(['Login hatalarını göster']);
    expect(t.events.typing).toEqual([true, false]);
    expect(t.advisors.spendToday()).toEqual({ a1: 120 });
    const req = t.requests[0];
    expect(req?.system).toContain('never write code');
    expect(req?.system).toContain('Be critical.');
    expect(req?.system).toContain('Reply in Turkish');
    expect(req?.messages[0]?.content).toContain('abc123');
    expect(req?.messages[0]?.content).toContain('Kaan: @elestirmen bu ne durumda?');
  });

  it('posts nothing for SKIP, and reports budget and provider failures only when asked', async () => {
    const t = setup(() => 'SKIP');
    t.store.commit({ type: 'advisor.saved', data: advisor() });
    t.advisors.onMessage(t.post('@elestirmen ?'), t.channel);
    await t.settle();
    expect(t.events.messages).toHaveLength(0);

    t.store.addSpend('a1', '2026-10-18', 10_000);
    t.advisors.onMessage(t.post('@elestirmen ?'), t.channel);
    await t.settle();
    expect(t.events.failed).toEqual(['over_budget']);
    expect(t.requests).toHaveLength(1);

    const u = setup(() => new LlmError('provider_auth'));
    u.store.commit({ type: 'advisor.saved', data: advisor() });
    u.advisors.onMessage(u.post('@elestirmen ?'), u.channel);
    await u.settle();
    expect(u.events.failed).toEqual(['provider_auth']);
  });

  it('lets advisors answer each other until the bot streak limit, and runs only its own advisors', async () => {
    let n = 0;
    const t = setup((req) => {
      n += 1;
      return req.system?.includes('@elestirmen') && !req.system.startsWith('You are Eleştirmen')
        ? `@elestirmen katılmıyorum (${n})`
        : `@davut sen ne dersin (${n})`;
    });
    t.store.commit({ type: 'advisor.saved', data: advisor() });
    t.store.commit({
      type: 'advisor.saved',
      data: advisor({ id: 'a2', name: 'Davut', handle: 'davut', personality: 'blunt' }),
    });
    t.store.commit({
      type: 'advisor.saved',
      data: advisor({ id: 'a3', name: 'Uzak', handle: 'uzak', owner: 'other' }),
    });
    t.advisors.onMessage(t.post('@elestirmen @uzak başla'), t.channel);
    await t.settle();
    expect(t.events.messages.length).toBe(MAX_BOT_STREAK);
    expect(t.events.messages.some((m) => m.author.kind === 'advisor' && m.author.id === 'a3')).toBe(false);
    expect(t.advisors.streak('c1')).toBe(MAX_BOT_STREAK);
  });

  it('drops in on its own when due, never in quiet hours or a dead channel', async () => {
    const t = setup(() => 'Testler bir haftadır yazılmadı.');
    t.store.commit({ type: 'advisor.saved', data: advisor({ chatter: 'high' }) });
    t.post('bugün login ekranını bitirdim');
    t.advisors.tick();
    await t.settle();
    expect(t.events.messages).toHaveLength(1);
    expect(t.requests[0]?.system).toContain('Nobody asked you');

    // Not again before its hour; in quiet hours not at all.
    t.post('tamam');
    t.advisors.tick();
    await t.settle();
    expect(t.events.messages).toHaveLength(1);
    t.setNow(new Date(2026, 9, 18, 23, 30).getTime());
    t.post('gece mesajı');
    t.advisors.tick();
    await t.settle();
    expect(t.events.messages).toHaveLength(1);

    // Two days later, with no person in the channel since: nothing.
    t.setNow(NOON + 48 * 3600_000);
    t.advisors.tick();
    await t.settle();
    expect(t.events.messages).toHaveLength(1);
  });

  it('may comment on a finished job, quoting the answer', async () => {
    const t = setup(() => 'Sonuçta test yok.', { random: 0 });
    t.store.commit({ type: 'advisor.saved', data: advisor() });
    const req = t.post('@claude login ekle');
    const answer = t.post('Login eklendi.', { kind: 'agent', id: 'ag', name: 'Claude' });
    t.store.commit({ type: 'message.edited', data: { id: answer.id, text: answer.text, edited: answer.created } });
    // The answer belongs to the job.
    const job: Job = {
      id: 'j1',
      channelId: 'c1',
      agentId: 'ag',
      requestId: req.id,
      state: 'done',
      steps: [],
      usage: { in: 0, cached: 0, out: 0 },
      started: 1,
    };
    t.store.commit({
      type: 'message.posted',
      data: { ...answer, id: 'ans', jobId: 'j1', created: answer.created + 1 },
    });
    t.advisors.onJobEnded(job);
    await t.settle();
    expect(t.events.messages).toHaveLength(1);
    expect(t.requests[0]?.messages[0]?.content).toContain('The worker Claude just finished a job');

    // Advisors with chatter off stay quiet.
    const u = setup(() => 'x', { random: 0 });
    u.store.commit({ type: 'advisor.saved', data: advisor({ chatter: 'off' }) });
    u.post('@claude x');
    u.advisors.onJobEnded({ ...job });
    await u.settle();
    expect(u.events.messages).toHaveLength(0);
  });

  it('sums up the last hours of a channel on /özet, reading more of it than a normal turn', async () => {
    const t = setup(() => '- Login bitti' + String.fromCharCode(10) + '- Testler açık');
    t.store.commit({ type: 'advisor.saved', data: advisor() });
    t.store.commit({ type: 'advisor.saved', data: advisor({ id: 'a2', handle: 'olumlu', name: 'Olumlu' }) });
    t.post('dünkü konu');
    t.setNow(NOON + 30 * 60 * 60 * 1000);
    for (let i = 0; i < 40; i++) t.post(`mesaj ${i}`);
    expect(t.advisors.digest(t.channel, 24, 'olumlu')?.handle).toBe('olumlu');
    await t.settle();
    expect(t.events.messages[0]).toMatchObject({
      author: { name: 'Olumlu' },
      text: '- Login bitti' + String.fromCharCode(10) + '- Testler açık',
    });
    const user = t.requests[0]?.messages[0]?.content ?? '';
    expect(user).toContain('mesaj 0');
    expect(user).toContain('mesaj 39');
    expect(user).not.toContain('dünkü konu');
    expect(user).toContain('last 24 hours');
    expect(t.advisors.digest({ ...t.channel, id: 'nope' }, 24)).toBeDefined();
  });

  it('runs a council: two rounds in turn, then a summary', async () => {
    const t = setup((req) => {
      const c = req.messages[0]?.content ?? '';
      const who = req.system?.startsWith('You are Davut') ? 'Davut' : 'Eleştirmen';
      return c.includes('Sum it up') ? `${who}: özet` : `${who} görüşü`;
    });
    t.store.commit({ type: 'advisor.saved', data: advisor() });
    t.store.commit({ type: 'advisor.saved', data: advisor({ id: 'a2', name: 'Davut', handle: 'davut' }) });
    t.post('/meclis fiyatlandırma');
    await t.advisors.council(t.channel, 'fiyatlandırma');
    expect(t.events.messages.map((m) => m.text)).toEqual([
      'Eleştirmen görüşü',
      'Davut görüşü',
      'Eleştirmen görüşü',
      'Davut görüşü',
      'özet',
    ]);
    expect(t.requests[2]?.messages[0]?.content).toContain('round 2 of 2');
  });
});

describe('advisors through the core', () => {
  function setupCore() {
    const { llm } = fakeLlm(() => 'Bence önce test yazılmalı.');
    const core = new Core({ appDir: tmp('lonca-app-'), language: 'tr', env: { PATH: '' }, platform: 'linux', llm });
    let listener: (f: unknown) => void = () => {};
    const sent: Frame[] = [];
    core.attach({ send: (f) => sent.push(f), onFrame: (l) => (listener = l) });
    let id = 0;
    const call = async <T>(method: string, params?: unknown): Promise<T> => {
      const rid = ++id;
      listener({ id: rid, method, params });
      for (let i = 0; i < 400; i++) {
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
    const events = (name: string) =>
      sent.filter((f) => 'event' in f && f.event === name).map((f) => (f as { data: unknown }).data);
    return { call, events };
  }

  it('saves advisors with checks, and runs /meclis through them', async () => {
    const { call, events } = setupCore();
    const ws = await call<{ channels: Channel[] }>('workspace.get');
    const genel = ws.channels[0] as Channel;
    await expect(call('advisors.council', { channelId: genel.id, topic: 'x' })).rejects.toThrow('no_advisors');
    const input = {
      name: 'Eleştirmen',
      handle: 'elestirmen',
      personality: 'critical',
      prompt: 'Be critical.',
      providerId: 'p1',
      model: 'm',
      channels: [genel.id, 'gone'],
      chatter: 'off',
      dailyTokens: 20_000,
    };
    await expect(call('advisors.save', { ...input, providerId: 'nope' })).rejects.toThrow('invalid_advisor');
    await expect(call('advisors.save', { ...input, dailyTokens: 5 })).rejects.toThrow('invalid_advisor');
    const saved = await call<Advisor>('advisors.save', input);
    expect(saved.channels).toEqual([genel.id]);
    await expect(call('advisors.save', { ...input })).rejects.toThrow('handle_taken');
    const msg = await call<Message>('advisors.council', { channelId: genel.id, topic: 'test planı' });
    expect(msg.text).toBe('/meclis test planı');
    for (let i = 0; i < 100 && !events('message.added').some((m) => (m as Message).author.kind === 'advisor'); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(events('message.added').some((m) => (m as Message).text === 'Bence önce test yazılmalı.')).toBe(true);
    const state = await call<{ advisors: Advisor[]; spend: Record<string, number> }>('workspace.get');
    expect(state.advisors).toHaveLength(1);
    expect(state.spend[saved.id]).toBe(120);
    await call('advisors.delete', { id: saved.id });
    expect((await call<{ advisors: Advisor[] }>('workspace.get')).advisors).toEqual([]);
  });
});
