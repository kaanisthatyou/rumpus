import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent, Message } from '@lonca/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Nudger, type NudgerDeps, nudgeButton, nudgeText, type Waiting } from '../src/nudges.js';
import { WorkspaceStore } from '../src/store.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

/** A repeatable stream of numbers in [0, 1). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s / 2 ** 32;
  };
}

const one: Waiting[] = [{ key: 'a:j1:q1', what: '`npm run build` onayı' }];
const three: Waiting[] = [
  ...one,
  { key: 'd:m1', what: '"zod güncellemesi şimdi mi?" sorusu' },
  { key: 'd:m2', what: '"vite yükseltilsin mi?" sorusu' },
];

describe('reminder lines', () => {
  it('reads differently nearly every time, in both languages, without exclamation marks', () => {
    for (const lang of ['tr', 'en'] as const) {
      const r = seeded(lang === 'tr' ? 7 : 11);
      const lines = Array.from({ length: 400 }, (_, i) =>
        nudgeText(lang, { name: 'Kaan Çelebi', items: i % 2 ? one : three, count: i % 5 }, r),
      );
      expect(new Set(lines).size).toBeGreaterThan(300);
      for (const l of lines) {
        expect(l).not.toMatch(/!/);
        expect(l).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(l).not.toMatch(/\s[.,?:]/);
        expect(l.trim()).toBe(l);
      }
      // Some name what waits, some list it, some are a word or two.
      expect(lines.some((l) => l.includes('npm run build'))).toBe(true);
      expect(lines.some((l) => l.includes('\n- '))).toBe(true);
      expect(lines.some((l) => l.length < 20)).toBe(true);
      expect(lines.some((l) => l.includes('Kaan'))).toBe(true);
      expect(lines.some((l) => l.includes('Çelebi'))).toBe(false);
    }
    const r = seeded(3);
    const buttons = new Set(Array.from({ length: 300 }, (_, i) => nudgeButton('tr', r, i % 8)));
    expect(buttons.size).toBeGreaterThan(20);
    expect(buttons.has('Tamam tamam geldim')).toBe(true);
    // The first is calm; from the sixth on, the agent is out of patience (and the button curter).
    const calm = Array.from({ length: 200 }, () => nudgeText('tr', { name: 'Kaan', items: one, count: 0 }, r));
    const late = Array.from({ length: 200 }, () => nudgeText('tr', { name: 'Kaan', items: one, count: 7 }, r));
    const impatient = /hadi|kök saldı|yaşlanıyoruz|susmam|parmaklarım|ısrar|eskidi/i;
    expect(calm.some((l) => impatient.test(l))).toBe(false);
    expect(late.filter((l) => impatient.test(l)).length).toBeGreaterThan(60);
    expect(calm.some((l) => /acelesi yok|müsait/i.test(l))).toBe(true);
    const lateButtons = new Set(Array.from({ length: 100 }, () => nudgeButton('tr', r, 7)));
    expect(lateButtons.has('Bakarım')).toBe(false);
    expect(nudgeText('tr', { name: 'Kaan', items: one, count: 0 }, seeded(1))).not.toMatch(/[a-z]{3,} (is|the|you)\b/);
  });
});

describe('the reminder schedule', () => {
  afterEach(() => vi.useRealTimers());

  function setup(over: Partial<NudgerDeps> = {}) {
    vi.useFakeTimers();
    let now = new Date(2026, 10, 18, 14, 0).getTime();
    const agent = { id: 'a1', name: 'Felix', handle: 'felix' } as Agent;
    let items: Waiting[] = [...one];
    const posted: Message[] = [];
    const typing: boolean[] = [];
    let muted: Record<string, string[]> = {};
    const deps: NudgerDeps = {
      agents: () => [agent],
      waiting: () => items,
      channelOf: () => 'c-felix',
      me: () => ({ id: 'dev1', name: 'Kaan', language: 'tr' }),
      quietHours: () => ({ from: '23:00', to: '08:00' }),
      post: (m) => posted.push(m),
      typing: (e) => typing.push(e.on),
      loadMuted: () => muted,
      saveMuted: (m) => {
        muted = JSON.parse(JSON.stringify(m));
      },
      now: () => now,
      random: seeded(5),
      ...over,
    };
    const n = new Nudger(deps);
    const wait = (min: number) => {
      now += min * 60_000;
      n.tick();
      vi.advanceTimersByTime(8000);
      now += 8000;
    };
    return {
      n,
      posted,
      typing,
      wait,
      setItems: (x: Waiting[]) => {
        items = x;
      },
      muted: () => muted,
      setNow: (t: number) => {
        now = t;
      },
    };
  }

  it('writes after a few minutes, types first, keeps writing every few minutes, and stops on the button', () => {
    const t = setup();
    t.n.tick(); // something waits: the run starts
    t.wait(2);
    expect(t.posted).toHaveLength(0);
    t.wait(5); // 7 minutes in: past the first gap (3 to 6)
    expect(t.posted).toHaveLength(1);
    expect(t.typing).toEqual([true, false]);
    expect(t.posted[0]).toMatchObject({ channelId: 'c-felix', author: { kind: 'agent', id: 'a1', name: 'Felix' } });
    expect(t.posted[0]?.nudge?.for).toBe('dev1');
    expect(t.posted[0]?.nudge?.button).toBeTruthy();
    for (let i = 0; i < 12; i++) t.wait(11);
    expect(t.posted.length).toBeGreaterThanOrEqual(8);
    const texts = t.posted.map((m) => m.text);
    expect(new Set(texts).size).toBe(texts.length);

    const before = t.posted.length;
    t.n.mute('a1', 'tr');
    for (let i = 0; i < 6; i++) t.wait(11);
    expect(t.posted).toHaveLength(before);
    expect(t.muted()).toEqual({ a1: ['a:j1:q1'] });

    // Something new waits: a new run, about that.
    t.setItems([...one, { key: 'd:m9', what: '"yeni soru" sorusu' }]);
    for (let i = 0; i < 3; i++) t.wait(4);
    expect(t.posted.length).toBeGreaterThan(before);
    // What stopped waiting is forgotten.
    t.setItems([]);
    t.wait(1);
    expect(t.muted()).toEqual({});
  });

  it('says nothing in quiet hours, nothing once it was answered, and grows its gaps over a long evening', () => {
    const t = setup();
    t.setNow(new Date(2026, 10, 18, 23, 30).getTime());
    t.n.tick();
    for (let i = 0; i < 20; i++) t.wait(10);
    expect(t.posted).toHaveLength(0);

    const u = setup();
    u.n.tick();
    for (let i = 0; i < 120; i++) u.wait(5); // ten hours
    // Every few minutes at first, then further apart: well under the 60 to 150 lines of steady gaps.
    expect(u.posted.length).toBeGreaterThan(8);
    expect(u.posted.length).toBeLessThan(40);

    const w = setup();
    w.n.tick();
    w.wait(7);
    expect(w.posted).toHaveLength(1);
    w.setItems([]);
    for (let i = 0; i < 6; i++) w.wait(11);
    expect(w.posted).toHaveLength(1);
  });
});

describe('what waits, in the store', () => {
  it('finds an agent’s unanswered questions and marks its reminders answered on this computer only', () => {
    const s = new WorkspaceStore(join(tmp('lonca-nudge-'), 'lonca.db'), 'dev1');
    s.commit({ type: 'channel.created', data: { id: 'c1', name: 'genel', kind: 'channel', topic: '', created: 1 } });
    s.commit({ type: 'channel.created', data: { id: 'c2', name: 'x', kind: 'channel', topic: '', created: 1 } });
    const agent = { kind: 'agent' as const, id: 'a1', name: 'Felix' };
    const person = { kind: 'person' as const, id: 'dev1', name: 'Kaan' };
    const post = (m: Partial<Message> & { id: string }) =>
      s.commit({ type: 'message.posted', data: { channelId: 'c1', author: agent, text: 'x', created: 10, ...m } });
    post({ id: 'q1', decisions: [{ question: 'Şimdi mi?' }], created: 10 });
    post({ id: 'q2', channelId: 'c2', decisions: [{ question: 'Hafta sonu mu?' }], created: 11 });
    post({ id: 'q3', decisions: [{ question: 'Eski' }], created: 1 });
    expect(s.openDecisions('a1', 5).map((m) => m.id)).toEqual(['q1', 'q2']);
    // Answered with the report attached, or by writing in the channel after it.
    post({
      id: 'p1',
      author: person,
      channelId: 'c3',
      cite: { id: 'q1', channelId: 'c1', title: '', at: 10, by: 'Felix' },
      created: 20,
    });
    post({ id: 'p2', author: person, channelId: 'c2', created: 21 });
    expect(s.openDecisions('a1', 5)).toEqual([]);

    post({ id: 'n1', text: 'Pşş', created: 30, nudge: { for: 'dev1', button: 'Tamam', done: true } });
    post({ id: 'n2', text: 'Eee', created: 31, nudge: { for: 'dev1', button: 'Geldim' } });
    post({ id: 'n3', text: 'Psst', created: 32, nudge: { for: 'dev2', button: 'OK' } });
    // A pressed mark never comes from a message.
    expect(s.message('n1')?.nudge).toEqual({ for: 'dev1', button: 'Tamam' });
    expect(
      s
        .markNudged('a1', 'dev1')
        .map((m) => m.id)
        .sort(),
    ).toEqual(['n1', 'n2']);
    expect(s.message('n2')?.nudge?.done).toBe(true);
    expect(s.message('n3')?.nudge?.done).toBeUndefined();
    expect(s.markNudged('a1', 'dev1')).toEqual([]);
  });
});
