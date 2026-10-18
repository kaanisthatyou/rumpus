import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Card, Channel, Message } from '@lonca/protocol';
import { describe, expect, it } from 'vitest';
import { canonical, eventPayload, LocalSigner, type SignedEvent, verifySignature } from '../src/identity.js';
import { Clock } from '../src/ids.js';
import { WorkspaceStore } from '../src/store.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const storeOf = (device: string) => new WorkspaceStore(join(tmp('lonca-sync-'), 'lonca.db'), device);

async function signAll(store: WorkspaceStore, signer: LocalSigner): Promise<void> {
  for (const e of store.unsigned()) store.setSignature(e.id, await signer.sign(eventPayload(e, 'ws1')));
}

function snapshot(store: WorkspaceStore) {
  return {
    channels: store.channels().map((c) => `${c.id}:${c.name}`),
    messages: store.messages('c1').map((m) => `${m.id}:${m.text}`),
    cards: store.cards().map((c) => `${c.id}:${c.title}:${c.status}`),
  };
}

function shuffle<T>(list: T[], seed: number): T[] {
  const out = [...list];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const channel: Channel = { id: 'c1', name: 'genel', kind: 'channel', topic: '', created: 1 };
const msg = (id: string, text: string, author = 'A'): Message => ({
  id,
  channelId: 'c1',
  author: { kind: 'person', id: author, name: author },
  text,
  created: 1,
});
const card = (title: string, status: Card['status']): Card => ({ id: 'k1', title, status, created: 1, updated: 1 });

describe('signed log', () => {
  it('signs canonical payloads that peers can check, and spots tampering', async () => {
    expect(canonical({ b: 1, a: [{ d: 2, c: undefined, e: null }] })).toBe('{"a":[{"d":2,"e":null}],"b":1}');
    const a = storeOf('A');
    const signer = new LocalSigner();
    a.commit({ type: 'channel.created', data: channel });
    await signAll(a, signer);
    const [e] = a.eventsAfter({});
    expect(e).toMatchObject({ author: 'A', n: 1, type: 'channel.created' });
    const ev = e as SignedEvent;
    const { sig, ...rest } = ev;
    expect(verifySignature(eventPayload(rest, 'ws1'), sig, signer.publicKey())).toBe(true);
    expect(
      verifySignature(eventPayload({ ...rest, data: { ...channel, name: 'x' } }, 'ws1'), sig, signer.publicKey()),
    ).toBe(false);
    expect(verifySignature(eventPayload(rest, 'ws2'), sig, signer.publicKey())).toBe(false);
    expect(verifySignature(eventPayload(rest, 'ws1'), sig, new LocalSigner().publicKey())).toBe(false);
  });

  it('ends up the same whatever order the events arrive in', async () => {
    const a = storeOf('A');
    const b = storeOf('B');
    const sa = new LocalSigner();
    const sb = new LocalSigner();
    a.commit({ type: 'channel.created', data: channel });
    a.commit({ type: 'message.posted', data: msg('m1', 'ilk') });
    a.commit({ type: 'card.saved', data: card('Login', 'todo') });
    await signAll(a, sa);
    for (const e of a.eventsAfter({})) b.ingest(e);
    // B edits after seeing A's events, then A edits again (later in clock time), deletes are in the mix too.
    b.commit({ type: 'message.edited', data: { id: 'm1', text: 'B düzeltti', edited: 2 } });
    b.commit({ type: 'card.saved', data: card('Login', 'doing') });
    b.commit({ type: 'message.posted', data: msg('m2', 'silinecek', 'B') });
    await signAll(b, sb);
    for (const e of b.eventsAfter(a.heads())) a.ingest(e);
    a.commit({ type: 'card.saved', data: card('Login formu', 'review') });
    a.commit({ type: 'message.deleted', data: { id: 'm2' } });
    a.commit({ type: 'channel.renamed', data: { id: 'c1', name: 'ana' } });
    await signAll(a, sa);

    const all = [...a.eventsAfter({}), ...b.eventsAfter({})].filter(
      (e, i, list) => list.findIndex((x) => x.id === e.id) === i,
    );
    expect(all).toHaveLength(9);
    const expected = {
      channels: ['c1:ana'],
      messages: ['m1:B düzeltti'],
      cards: ['k1:Login formu:review'],
    };
    expect(snapshot(a)).toEqual(expected);
    for (let seed = 1; seed <= 12; seed++) {
      const c = storeOf(`C${seed}`);
      for (const e of shuffle(all, seed)) c.ingest(e);
      expect(snapshot(c)).toEqual(expected);
      expect(c.heads()).toEqual(a.heads());
      expect(c.search('düzeltti').map((m) => m.id)).toEqual(['m1']);
      expect(c.search('silinecek')).toEqual([]);
    }
  });

  it('keeps heads at the last event without a gap, ignores repeats, and lets local time pass what it saw', async () => {
    const a = storeOf('A');
    const sa = new LocalSigner();
    a.commit({ type: 'channel.created', data: channel });
    for (let i = 1; i <= 3; i++) a.commit({ type: 'message.posted', data: msg(`m${i}`, `${i}`) });
    await signAll(a, sa);
    const events = a.eventsAfter({});
    const b = storeOf('B');
    b.ingest(events[0] as SignedEvent);
    b.ingest(events[2] as SignedEvent);
    expect(b.heads()).toEqual({ A: 1 });
    expect(b.eventsAfter({}).map((e) => e.n)).toEqual([1]);
    expect(b.ingest(events[2] as SignedEvent)).toBe(false);
    b.ingest(events[1] as SignedEvent);
    b.ingest(events[3] as SignedEvent);
    expect(b.heads()).toEqual({ A: 4 });
    expect(a.eventsAfter({ A: 2 }).map((e) => e.n)).toEqual([3, 4]);
    // Unsigned own events are not offered.
    a.commit({ type: 'message.posted', data: msg('m9', 'imzasız') });
    expect(a.heads()).toEqual({ A: 4 });

    const clock = new Clock('X');
    clock.observe('zzzzzzzzzz.0005.Y');
    expect(clock.now(1).startsWith('zzzzzzzzzz.0006')).toBe(true);
  });

  it('gives events from before Phase 3 their counts and entities', () => {
    const dir = tmp('lonca-old-');
    const file = join(dir, 'lonca.db');
    const db = new DatabaseSync(file);
    db.exec(
      'CREATE TABLE events (seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, at TEXT NOT NULL, author TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL)',
    );
    db.prepare('INSERT INTO events (id, at, author, type, data) VALUES (?, ?, ?, ?, ?)').run(
      'e1',
      '0000000001.0000.A',
      'A',
      'channel.created',
      JSON.stringify(channel),
    );
    db.prepare('INSERT INTO events (id, at, author, type, data) VALUES (?, ?, ?, ?, ?)').run(
      'e2',
      '0000000002.0000.A',
      'A',
      'channel.renamed',
      JSON.stringify({ id: 'c1', name: 'eski' }),
    );
    db.close();
    const store = new WorkspaceStore(file, 'A');
    store.commit({ type: 'message.posted', data: msg('m1', 'yeni') });
    expect(store.unsigned().map((e) => [e.n, e.type])).toEqual([
      [1, 'channel.created'],
      [2, 'channel.renamed'],
      [3, 'message.posted'],
    ]);
  });
});
