// One workspace in one SQLite file (Node's built-in node:sqlite, no native module to build).
// Every change is an event in an append-only log first, then applied to the tables; Phase 3 syncs the log.
// Running jobs are local state of this machine and live in their own table, outside the log.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  type Advisor,
  type Agent,
  type Author,
  type Card,
  type Channel,
  cleanProfile,
  type Goal,
  ImageRefSchema,
  isHexColor,
  type Job,
  LIMITS,
  type MemorySuggestion,
  type Message,
  type Profile,
  type Project,
  type ProjectStatus,
  type RecordItem,
  type RoleTag,
  type Routine,
  type WorkspaceLook,
} from '@lonca/protocol';
import type { SignedEvent } from './identity.js';
import { Clock, newId } from './ids.js';
import type { Genesis, Member } from './membership.js';

type Row = Record<string, unknown>;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = OFF;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, at TEXT NOT NULL, author TEXT NOT NULL,
  type TEXT NOT NULL, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, agent_id TEXT, topic TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, created INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, author TEXT NOT NULL, text TEXT NOT NULL,
  created INTEGER NOT NULL, edited INTEGER, deleted INTEGER NOT NULL DEFAULT 0, job_id TEXT, refs TEXT
);
CREATE INDEX IF NOT EXISTS messages_by_channel ON messages (channel_id, created);
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  text, content = 'messages', content_rowid = 'rowid', tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts (rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF text ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO messages_fts (rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, request_id TEXT NOT NULL, data TEXT NOT NULL, started INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_by_channel ON jobs (channel_id, started);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, created INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS advisors (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, created INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS advisor_spend (
  advisor_id TEXT NOT NULL, day TEXT NOT NULL, tokens INTEGER NOT NULL, PRIMARY KEY (advisor_id, day)
);
CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS endpoints (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY, role TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS join_requests (id TEXT PRIMARY KEY, data TEXT NOT NULL, state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memory (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memory_suggestions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS entity_at (entity TEXT PRIMARY KEY, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS heads (author TEXT PRIMARY KEY, n INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, created INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS progress (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS project_folders (id TEXT PRIMARY KEY, folder TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, created INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS looks (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, created INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tagged (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  agent_id TEXT NOT NULL, channel_id TEXT NOT NULL, session_id TEXT NOT NULL, PRIMARY KEY (agent_id, channel_id)
);
`;

export type WorkspaceEvent =
  | { type: 'channel.created'; data: Channel }
  | { type: 'channel.renamed'; data: { id: string; name: string } }
  | { type: 'channel.deleted'; data: { id: string } }
  | { type: 'agent.saved'; data: Agent }
  | { type: 'agent.deleted'; data: { id: string } }
  | { type: 'advisor.saved'; data: Advisor }
  | { type: 'advisor.deleted'; data: { id: string } }
  | { type: 'goal.saved'; data: Goal }
  | { type: 'workspace.created'; data: Genesis }
  | { type: 'member.certified'; data: Omit<Member, 'removed'> }
  | { type: 'member.removed'; data: { device: string; at: number; upTo: number } }
  | { type: 'device.endpoint'; data: { device: string; addresses: string[] } }
  | { type: 'job.saved'; data: Job }
  | { type: 'memory.saved'; data: { id: string; text: string } }
  | { type: 'message.posted'; data: Message }
  | { type: 'message.edited'; data: { id: string; text: string; edited: number } }
  | { type: 'message.deleted'; data: { id: string } }
  | { type: 'routine.saved'; data: Routine }
  | { type: 'routine.deleted'; data: { id: string } }
  | { type: 'card.saved'; data: Card }
  | { type: 'card.deleted'; data: { id: string } }
  | { type: 'record.saved'; data: RecordItem }
  | { type: 'record.deleted'; data: { id: string } }
  | { type: 'project.saved'; data: Project }
  | { type: 'project.deleted'; data: { id: string } }
  | { type: 'progress.saved'; data: ProjectStatus }
  /** How a member presents themselves; written by that member's own device. */
  | { type: 'profile.saved'; data: Profile & { device: string } }
  /** The workspace's name, the line about it, its icon and banner (`id` is always `workspace`). */
  | { type: 'look.saved'; data: WorkspaceLook & { id: 'workspace' } }
  /** A role in Discord's sense: a name with a color. It grants nothing. */
  | { type: 'tag.saved'; data: RoleTag }
  | { type: 'tag.deleted'; data: { id: string } }
  /** The roles a member carries. */
  | { type: 'tagged.saved'; data: { device: string; tags: string[] } };

const json = <T>(text: unknown): T => JSON.parse(String(text)) as T;

/** An address a member's app listens on: an IPv4 or bracketed IPv6 address and a port. */
const ENDPOINT = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]{2,39}\]):\d{1,5}$/i;

/** The tables an entity kind lives in (`<kind>:<id>`, from the event type's first word and the data's id). */
const TABLES: Record<string, string> = {
  channel: 'channels',
  agent: 'agents',
  message: 'messages',
  card: 'cards',
  routine: 'routines',
  record: 'records',
  advisor: 'advisors',
  goal: 'goals',
  member: 'members',
  device: 'endpoints',
  job: 'jobs',
  memory: 'memory',
  project: 'projects',
  progress: 'progress',
  profile: 'profiles',
  look: 'looks',
  tag: 'tags',
  tagged: 'tagged',
};

export function entityOf(type: string, data: unknown): string {
  const kind = type.slice(0, type.indexOf('.'));
  const d = (data ?? {}) as { id?: unknown; device?: unknown };
  return `${kind}:${String(d.id ?? d.device ?? '')}`;
}

function toSigned(r: Row): SignedEvent {
  return {
    id: String(r.id),
    author: String(r.author),
    n: Number(r.n),
    at: String(r.at),
    type: String(r.type),
    data: json(r.data),
    sig: String(r.sig ?? ''),
  };
}

function toChannel(r: Row): Channel {
  return {
    id: String(r.id),
    name: String(r.name),
    kind: r.kind === 'agent' ? 'agent' : 'channel',
    ...(r.agent_id ? { agentId: String(r.agent_id) } : {}),
    topic: String(r.topic ?? ''),
    created: Number(r.created),
  };
}

function toMessage(r: Row): Message {
  return {
    id: String(r.id),
    channelId: String(r.channel_id),
    author: json<Author>(r.author),
    text: String(r.text),
    created: Number(r.created),
    ...(r.edited ? { edited: Number(r.edited) } : {}),
    ...(r.job_id ? { jobId: String(r.job_id) } : {}),
    ...(r.refs ? { refs: json<string[]>(r.refs) } : {}),
    ...(r.handover ? { handover: json<{ requestId: string; agentId: string }>(r.handover) } : {}),
    ...(r.result ? { result: json<Record<string, unknown>>(r.result) } : {}),
    ...(r.routine ? { routine: String(r.routine) } : {}),
  };
}

export class WorkspaceStore {
  private readonly db: DatabaseSync;
  private readonly clock: Clock;

  constructor(
    file: string,
    private readonly deviceId: string,
  ) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
    const columns = (this.db.prepare('PRAGMA table_info(messages)').all() as Row[]).map((r) => String(r.name));
    if (!columns.includes('refs')) this.db.exec('ALTER TABLE messages ADD COLUMN refs TEXT');
    if (!columns.includes('handover')) this.db.exec('ALTER TABLE messages ADD COLUMN handover TEXT');
    if (!columns.includes('result')) this.db.exec('ALTER TABLE messages ADD COLUMN result TEXT');
    if (!columns.includes('routine')) this.db.exec('ALTER TABLE messages ADD COLUMN routine TEXT');
    this.migrateEvents();
    this.clock = new Clock(deviceId);
    const latest = this.db.prepare('SELECT MAX(at) AS at FROM events').get() as Row | undefined;
    if (latest?.at) this.clock.observe(String(latest.at));
  }

  close(): void {
    this.db.close();
  }

  meta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined;
    return row ? String(row.value) : undefined;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  // ---------------------------------------------------------------- the log

  /** Appends an event and applies it, in one transaction. */
  /** Events from before Phase 3 get their author count and entity; a one-time step per database. */
  private migrateEvents(): void {
    const cols = (this.db.prepare('PRAGMA table_info(events)').all() as Row[]).map((r) => String(r.name));
    if (cols.includes('entity')) return;
    this.db.exec('BEGIN');
    try {
      this.db.exec('ALTER TABLE events ADD COLUMN n INTEGER');
      this.db.exec('ALTER TABLE events ADD COLUMN sig TEXT');
      this.db.exec('ALTER TABLE events ADD COLUMN entity TEXT');
      this.db.exec(
        "UPDATE events SET entity = substr(type, 1, instr(type, '.') - 1) || ':' || coalesce(json_extract(data, '$.id'), '')",
      );
      this.db.exec(
        'UPDATE events SET n = (SELECT COUNT(*) FROM events e2 WHERE e2.author = events.author AND e2.seq <= events.seq)',
      );
      this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS events_by_author ON events (author, n)');
      this.db.exec('CREATE INDEX IF NOT EXISTS events_by_entity ON events (entity, at)');
      this.db.exec('INSERT OR REPLACE INTO heads (author, n) SELECT author, MAX(n) FROM events GROUP BY author');
      this.db.exec('INSERT OR REPLACE INTO entity_at (entity, at) SELECT entity, MAX(at) FROM events GROUP BY entity');
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  commit(event: WorkspaceEvent): void {
    this.db.exec('BEGIN');
    try {
      const n = this.head(this.deviceId) + 1;
      const at = this.clock.now();
      const entity = entityOf(event.type, event.data);
      this.db
        .prepare('INSERT INTO events (id, at, author, type, data, n, entity) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(newId(), at, this.deviceId, event.type, JSON.stringify(event.data), n, entity);
      this.db.prepare('INSERT OR REPLACE INTO heads (author, n) VALUES (?, ?)').run(this.deviceId, n);
      this.apply(event);
      this.db.prepare('INSERT OR REPLACE INTO entity_at (entity, at) VALUES (?, ?)').run(entity, at);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    this.onCommit?.();
  }

  /** Called after every local event (a team workspace syncs then). */
  onCommit: (() => void) | undefined;

  // ---------------------------------------------------------------- invites (local to the inviter)

  addInvite(tokenHash: string, role: string, expires: number): void {
    this.db.prepare('INSERT INTO invites (token, role, expires) VALUES (?, ?, ?)').run(tokenHash, role, expires);
  }

  /** Uses up an invite: its role when it is valid, unused and not expired. */
  takeInvite(tokenHash: string, now = Date.now()): string | undefined {
    const r = this.db.prepare('SELECT role, expires, used FROM invites WHERE token = ?').get(tokenHash) as
      | Row
      | undefined;
    if (!r || Number(r.used) || Number(r.expires) < now) return undefined;
    this.db.prepare('UPDATE invites SET used = 1 WHERE token = ?').run(tokenHash);
    return String(r.role);
  }

  saveJoinRequest<T extends { id: string }>(req: T, state: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO join_requests (id, data, state) VALUES (?, ?, ?)')
      .run(req.id, JSON.stringify(req), state);
  }

  joinRequest<T>(id: string): { request: T; state: string } | undefined {
    const r = this.db.prepare('SELECT data, state FROM join_requests WHERE id = ?').get(id) as Row | undefined;
    return r ? { request: json<T>(r.data), state: String(r.state) } : undefined;
  }

  joinRequests<T>(state = 'pending'): T[] {
    return (this.db.prepare('SELECT data FROM join_requests WHERE state = ?').all(state) as Row[]).map((r) =>
      json<T>(r.data),
    );
  }

  /** The shared memory sections, by name. */
  memory(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of this.db.prepare('SELECT data FROM memory').all() as Row[]) {
      const d = json<{ id: string; text: string }>(r.data);
      out[d.id] = d.text;
    }
    return out;
  }

  memorySuggestions(): MemorySuggestion[] {
    return (this.db.prepare('SELECT data FROM memory_suggestions').all() as Row[])
      .map((r) => json<MemorySuggestion>(r.data))
      .sort((a, b) => a.at - b.at);
  }

  saveMemorySuggestion(s: MemorySuggestion): void {
    this.db.prepare('INSERT OR REPLACE INTO memory_suggestions (id, data) VALUES (?, ?)').run(s.id, JSON.stringify(s));
  }

  dropMemorySuggestion(id: string): MemorySuggestion | undefined {
    const r = this.db.prepare('SELECT data FROM memory_suggestions WHERE id = ?').get(id) as Row | undefined;
    if (!r) return undefined;
    this.db.prepare('DELETE FROM memory_suggestions WHERE id = ?').run(id);
    return json<MemorySuggestion>(r.data);
  }

  /** The channel a message was in, also after it was deleted. */
  messageChannel(id: string): string | undefined {
    const r = this.db.prepare('SELECT channel_id FROM messages WHERE id = ?').get(id) as Row | undefined;
    return r ? String(r.channel_id) : undefined;
  }

  // ---------------------------------------------------------------- sync (Phase 3)

  /** The highest count up to which every event of an author is here. */
  private head(author: string): number {
    const r = this.db.prepare('SELECT n FROM heads WHERE author = ?').get(author) as Row | undefined;
    return r ? Number(r.n) : 0;
  }

  /**
   * What this copy can give others: for each author, the count up to which it holds every event signed. Own events
   * count once they are signed (they are signed in order).
   */
  heads(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.db.prepare('SELECT author, n FROM heads').all() as Row[]) out[String(r.author)] = Number(r.n);
    const own = this.db
      .prepare('SELECT MAX(n) AS n FROM events WHERE author = ? AND sig IS NOT NULL')
      .get(this.deviceId) as Row | undefined;
    if (own?.n) out[this.deviceId] = Number(own.n);
    else delete out[this.deviceId];
    return out;
  }

  /** Signed events another copy lacks, judged by its heads; oldest first per author. */
  eventsAfter(theirs: Record<string, number>, limit = 500): SignedEvent[] {
    const out: SignedEvent[] = [];
    for (const [author, mine] of Object.entries(this.heads())) {
      const from = Math.max(0, Math.floor(Number(theirs[author]) || 0));
      if (mine <= from) continue;
      const rows = this.db
        .prepare(
          'SELECT id, author, n, at, type, data, sig FROM events WHERE author = ? AND n > ? AND n <= ? AND sig IS NOT NULL ORDER BY n LIMIT ?',
        )
        .all(author, from, mine, limit - out.length) as Row[];
      out.push(...rows.map(toSigned));
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Own events waiting for a signature, in order. */
  unsigned(limit = 200): Omit<SignedEvent, 'sig'>[] {
    return (
      this.db
        .prepare('SELECT id, author, n, at, type, data FROM events WHERE author = ? AND sig IS NULL ORDER BY n LIMIT ?')
        .all(this.deviceId, limit) as Row[]
    ).map((r) => {
      const { sig: _sig, ...rest } = toSigned({ ...r, sig: '' });
      return rest;
    });
  }

  setSignature(id: string, sig: string): void {
    this.db.prepare('UPDATE events SET sig = ? WHERE id = ? AND sig IS NULL').run(sig, id);
  }

  /**
   * An event from another copy (already checked by the caller). New events change the tables; an event older than
   * what its entity already shows makes the entity be built again from the log, so every copy ends up the same
   * whatever order events arrive in. Returns false for an event already here.
   */
  ingest(e: SignedEvent): boolean {
    if (this.db.prepare('SELECT 1 FROM events WHERE id = ?').get(e.id)) return false;
    if (this.db.prepare('SELECT 1 FROM events WHERE author = ? AND n = ?').get(e.author, e.n)) return false;
    const entity = entityOf(e.type, e.data);
    this.clock.observe(e.at);
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare('INSERT INTO events (id, at, author, type, data, n, sig, entity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(e.id, e.at, e.author, e.type, JSON.stringify(e.data), e.n, e.sig, entity);
      // The author's head moves over every event now present without a gap.
      let head = this.head(e.author);
      while (this.db.prepare('SELECT 1 FROM events WHERE author = ? AND n = ?').get(e.author, head + 1)) head += 1;
      this.db.prepare('INSERT OR REPLACE INTO heads (author, n) VALUES (?, ?)').run(e.author, head);
      const last = this.db.prepare('SELECT at FROM entity_at WHERE entity = ?').get(entity) as Row | undefined;
      if (!last || e.at > String(last.at)) {
        this.apply({ type: e.type, data: e.data } as WorkspaceEvent);
        this.db.prepare('INSERT OR REPLACE INTO entity_at (entity, at) VALUES (?, ?)').run(entity, e.at);
      } else {
        this.rebuild(entity);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return true;
  }

  /** Builds one entity again from its events in clock order. */
  private rebuild(entity: string): void {
    const [kind, id] = [entity.slice(0, entity.indexOf(':')), entity.slice(entity.indexOf(':') + 1)];
    const table = TABLES[kind];
    if (!table) return;
    this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    const rows = this.db.prepare('SELECT type, data, at FROM events WHERE entity = ? ORDER BY at').all(entity) as Row[];
    for (const r of rows) this.apply({ type: String(r.type), data: json(r.data) } as WorkspaceEvent);
    const last = rows.at(-1);
    if (last)
      this.db.prepare('INSERT OR REPLACE INTO entity_at (entity, at) VALUES (?, ?)').run(entity, String(last.at));
  }

  private apply(e: WorkspaceEvent): void {
    switch (e.type) {
      case 'channel.created': {
        const c = e.data;
        this.db
          .prepare(
            'INSERT OR IGNORE INTO channels (id, name, kind, agent_id, topic, created) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(c.id, c.name, c.kind, c.agentId ?? null, c.topic, c.created);
        return;
      }
      case 'channel.renamed':
        this.db.prepare('UPDATE channels SET name = ? WHERE id = ?').run(e.data.name, e.data.id);
        return;
      case 'channel.deleted':
        this.db.prepare('UPDATE channels SET deleted = 1 WHERE id = ?').run(e.data.id);
        return;
      case 'agent.saved':
        this.db
          .prepare(
            'INSERT INTO agents (id, data, created) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data, deleted = 0',
          )
          .run(e.data.id, JSON.stringify(e.data), e.data.created);
        return;
      case 'agent.deleted':
        this.db.prepare('UPDATE agents SET deleted = 1 WHERE id = ?').run(e.data.id);
        return;
      case 'advisor.saved':
        this.db
          .prepare(
            'INSERT INTO advisors (id, data, created) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data, deleted = 0',
          )
          .run(e.data.id, JSON.stringify(e.data), e.data.created);
        return;
      case 'advisor.deleted':
        this.db.prepare('UPDATE advisors SET deleted = 1 WHERE id = ?').run(e.data.id);
        return;
      case 'workspace.created':
        // The first one wins; a second genesis for the same workspace is refused before it gets here.
        if (!this.meta('genesis')) this.setMeta('genesis', JSON.stringify(e.data));
        return;
      case 'member.certified': {
        const { device, publicKey, name, role, expires } = e.data;
        this.db
          .prepare('INSERT OR REPLACE INTO members (id, data) VALUES (?, ?)')
          .run(device, JSON.stringify({ device, publicKey, name, role, expires }));
        return;
      }
      case 'member.removed': {
        const m = this.member(e.data.device);
        if (m) {
          this.db
            .prepare('UPDATE members SET data = ? WHERE id = ?')
            .run(JSON.stringify({ ...m, removed: e.data.at, upTo: e.data.upTo }), e.data.device);
        }
        return;
      }
      case 'job.saved':
        this.saveJob(e.data);
        return;
      case 'memory.saved':
        this.db
          .prepare('INSERT OR REPLACE INTO memory (id, data) VALUES (?, ?)')
          .run(e.data.id, JSON.stringify(e.data));
        return;
      case 'device.endpoint':
        this.db.prepare('INSERT OR REPLACE INTO endpoints (id, data) VALUES (?, ?)').run(
          e.data.device,
          // A member's own word about where their app listens: kept only in the shape of an IP and a port.
          // Which IPs are called at all is decided where the call is made (`peerTarget`).
          JSON.stringify({
            addresses: (Array.isArray(e.data.addresses) ? e.data.addresses : [])
              .filter((a): a is string => typeof a === 'string' && ENDPOINT.test(a))
              .slice(0, 8),
          }),
        );
        return;
      case 'goal.saved':
        this.db
          .prepare(
            'INSERT INTO goals (id, data, created) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data',
          )
          .run(e.data.id, JSON.stringify(e.data), e.data.created);
        return;
      case 'message.posted': {
        const m = e.data;
        this.db
          .prepare(
            'INSERT OR IGNORE INTO messages (id, channel_id, author, text, created, job_id, refs, handover, result, routine) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            m.id,
            m.channelId,
            JSON.stringify(m.author),
            // The sender's own app refuses a longer message; another member's computer is held to the same
            // length here, where every copy applies it alike (one oversized message froze nobody's channel yet,
            // and should not get the chance).
            String(m.text ?? '').slice(0, LIMITS.message),
            m.created,
            m.jobId ?? null,
            m.refs?.length ? JSON.stringify(m.refs) : null,
            m.handover ? JSON.stringify({ requestId: m.handover.requestId, agentId: m.handover.agentId }) : null,
            m.result ? JSON.stringify(m.result).slice(0, 8000) : null,
            m.routine ?? null,
          );
        return;
      }
      case 'message.edited':
        this.db
          .prepare('UPDATE messages SET text = ?, edited = ? WHERE id = ?')
          .run(String(e.data.text ?? '').slice(0, LIMITS.message), e.data.edited, e.data.id);
        return;
      case 'message.deleted':
        this.db.prepare("UPDATE messages SET deleted = 1, text = '' WHERE id = ?").run(e.data.id);
        return;
      case 'routine.saved':
        this.db
          .prepare(
            'INSERT INTO routines (id, data, created) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data, deleted = 0',
          )
          .run(e.data.id, JSON.stringify(e.data), e.data.created);
        return;
      case 'routine.deleted':
        this.db.prepare('UPDATE routines SET deleted = 1 WHERE id = ?').run(e.data.id);
        return;
      case 'card.saved':
        this.db
          .prepare(
            'INSERT INTO cards (id, data, created) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data, deleted = 0',
          )
          .run(e.data.id, JSON.stringify(e.data), e.data.created);
        return;
      case 'card.deleted':
        this.db.prepare('UPDATE cards SET deleted = 1 WHERE id = ?').run(e.data.id);
        return;
      case 'record.saved':
        this.db
          .prepare(
            'INSERT INTO records (id, kind, data, created) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data, deleted = 0',
          )
          .run(e.data.id, e.data.kind, JSON.stringify(e.data), e.data.created);
        return;
      case 'record.deleted':
        this.db.prepare('UPDATE records SET deleted = 1 WHERE id = ?').run(e.data.id);
        return;
      case 'project.saved':
        this.db
          .prepare(
            'INSERT INTO projects (id, data, created) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data, deleted = 0',
          )
          .run(e.data.id, JSON.stringify(e.data), e.data.created);
        return;
      case 'project.deleted':
        this.db.prepare('UPDATE projects SET deleted = 1 WHERE id = ?').run(e.data.id);
        return;
      case 'progress.saved':
        this.db
          .prepare('INSERT OR REPLACE INTO progress (id, data) VALUES (?, ?)')
          .run(e.data.id, JSON.stringify(e.data));
        return;
      // What follows comes from other members' computers too: every field is checked again before it is kept.
      case 'profile.saved':
        this.db
          .prepare('INSERT OR REPLACE INTO profiles (id, data) VALUES (?, ?)')
          .run(String(e.data.device), JSON.stringify(cleanProfile(e.data)));
        return;
      case 'look.saved': {
        const image = (v: unknown) => {
          const parsed = ImageRefSchema.safeParse(v);
          return parsed.success ? parsed.data : undefined;
        };
        const icon = image(e.data.icon);
        const banner = image(e.data.banner);
        const look: WorkspaceLook = {
          name: String(e.data.name ?? '')
            .trim()
            .slice(0, LIMITS.workspaceName),
          about: String(e.data.about ?? '').slice(0, LIMITS.workspaceAbout),
          ...(icon ? { icon } : {}),
          ...(banner ? { banner } : {}),
        };
        this.db.prepare('INSERT OR REPLACE INTO looks (id, data) VALUES (?, ?)').run('workspace', JSON.stringify(look));
        return;
      }
      case 'tag.saved': {
        const tag: RoleTag = {
          id: String(e.data.id),
          name: String(e.data.name ?? '')
            .trim()
            .slice(0, LIMITS.roleName),
          color: isHexColor(e.data.color) ? e.data.color : '',
          created: Number(e.data.created) || 0,
        };
        this.db
          .prepare(
            'INSERT INTO tags (id, data, created) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data, deleted = 0',
          )
          .run(tag.id, JSON.stringify(tag), tag.created);
        return;
      }
      case 'tag.deleted':
        this.db.prepare('UPDATE tags SET deleted = 1 WHERE id = ?').run(e.data.id);
        return;
      case 'tagged.saved': {
        const tags = Array.isArray(e.data.tags)
          ? [...new Set(e.data.tags.filter((t): t is string => typeof t === 'string'))].slice(0, LIMITS.memberRoles)
          : [];
        this.db
          .prepare('INSERT OR REPLACE INTO tagged (id, data) VALUES (?, ?)')
          .run(String(e.data.device), JSON.stringify(tags));
        return;
      }
    }
  }

  // ---------------------------------------------------------------- how people and the workspace look

  profile(device: string): Profile | undefined {
    const r = this.db.prepare('SELECT data FROM profiles WHERE id = ?').get(device) as Row | undefined;
    return r ? json<Profile>(r.data) : undefined;
  }

  profiles(): Record<string, Profile> {
    const out: Record<string, Profile> = {};
    for (const r of this.db.prepare('SELECT id, data FROM profiles').all() as Row[]) {
      out[String(r.id)] = json<Profile>(r.data);
    }
    return out;
  }

  look(): WorkspaceLook | undefined {
    const r = this.db.prepare("SELECT data FROM looks WHERE id = 'workspace'").get() as Row | undefined;
    return r ? json<WorkspaceLook>(r.data) : undefined;
  }

  /** The workspace's roles (names with a color), in the order they were made. */
  tags(): RoleTag[] {
    return (this.db.prepare('SELECT data FROM tags WHERE deleted = 0 ORDER BY created, id').all() as Row[]).map((r) =>
      json<RoleTag>(r.data),
    );
  }

  /** The roles each member carries, by device. */
  tagged(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const r of this.db.prepare('SELECT id, data FROM tagged').all() as Row[]) {
      out[String(r.id)] = json<string[]>(r.data);
    }
    return out;
  }

  /** An invite as it stands, without using it. */
  invite(tokenHash: string): { role: string; expires: number; used: boolean } | undefined {
    const r = this.db.prepare('SELECT role, expires, used FROM invites WHERE token = ?').get(tokenHash) as
      | Row
      | undefined;
    return r ? { role: String(r.role), expires: Number(r.expires), used: Boolean(Number(r.used)) } : undefined;
  }

  eventCount(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM events').get() as Row).n);
  }

  // ---------------------------------------------------------------- reads

  channels(): Channel[] {
    // Normal channels first, then agents' own channels; each in the order they were made.
    const sql = "SELECT * FROM channels WHERE deleted = 0 ORDER BY CASE kind WHEN 'channel' THEN 0 ELSE 1 END, created";
    return (this.db.prepare(sql).all() as Row[]).map(toChannel);
  }

  channel(id: string): Channel | undefined {
    const r = this.db.prepare('SELECT * FROM channels WHERE id = ? AND deleted = 0').get(id) as Row | undefined;
    return r ? toChannel(r) : undefined;
  }

  agents(): Agent[] {
    return (this.db.prepare('SELECT data FROM agents WHERE deleted = 0 ORDER BY created').all() as Row[]).map((r) =>
      json<Agent>(r.data),
    );
  }

  agent(id: string): Agent | undefined {
    const r = this.db.prepare('SELECT data FROM agents WHERE id = ? AND deleted = 0').get(id) as Row | undefined;
    return r ? json<Agent>(r.data) : undefined;
  }

  advisors(): Advisor[] {
    return (this.db.prepare('SELECT data FROM advisors WHERE deleted = 0 ORDER BY created').all() as Row[]).map((r) =>
      json<Advisor>(r.data),
    );
  }

  advisor(id: string): Advisor | undefined {
    const r = this.db.prepare('SELECT data FROM advisors WHERE id = ? AND deleted = 0').get(id) as Row | undefined;
    return r ? json<Advisor>(r.data) : undefined;
  }

  member(device: string): Member | undefined {
    const r = this.db.prepare('SELECT data FROM members WHERE id = ?').get(device) as Row | undefined;
    return r ? json<Member>(r.data) : undefined;
  }

  members(): Member[] {
    return (this.db.prepare('SELECT data FROM members').all() as Row[]).map((r) => json<Member>(r.data));
  }

  endpoints(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const r of this.db.prepare('SELECT id, data FROM endpoints').all() as Row[]) {
      out[String(r.id)] = json<{ addresses: string[] }>(r.data).addresses;
    }
    return out;
  }

  /** Who wrote an entity's first event: the owner of an agent or advisor, the writer of a message. */
  firstAuthor(entity: string): string | undefined {
    const r = this.db.prepare('SELECT author FROM events WHERE entity = ? ORDER BY at LIMIT 1').get(entity) as
      | Row
      | undefined;
    return r ? String(r.author) : undefined;
  }

  goals(): Goal[] {
    return (this.db.prepare('SELECT data FROM goals ORDER BY created').all() as Row[]).map((r) => json<Goal>(r.data));
  }

  goal(id: string): Goal | undefined {
    const r = this.db.prepare('SELECT data FROM goals WHERE id = ?').get(id) as Row | undefined;
    return r ? json<Goal>(r.data) : undefined;
  }

  message(id: string): Message | undefined {
    const r = this.db.prepare('SELECT * FROM messages WHERE id = ? AND deleted = 0').get(id) as Row | undefined;
    return r ? toMessage(r) : undefined;
  }

  /** The answer message a job ended with. */
  answerOf(jobId: string): Message | undefined {
    const r = this.db
      .prepare('SELECT * FROM messages WHERE job_id = ? AND deleted = 0 ORDER BY created DESC LIMIT 1')
      .get(jobId) as Row | undefined;
    return r ? toMessage(r) : undefined;
  }

  /** Newest `limit` messages before `before` (ms), returned oldest first. */
  messages(channelId: string, opts: { before?: number; limit?: number } = {}): Message[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM messages WHERE channel_id = ? AND deleted = 0 AND created < ? ORDER BY created DESC, rowid DESC LIMIT ?',
      )
      .all(channelId, opts.before ?? Number.MAX_SAFE_INTEGER, opts.limit ?? 100) as Row[];
    return rows.map(toMessage).reverse();
  }

  search(query: string, limit = 50): Message[] {
    const terms = query
      .split(/\s+/)
      .map((w) => w.replace(/["*]/g, ''))
      .filter(Boolean)
      .map((w) => `"${w}"*`)
      .join(' ');
    if (!terms) return [];
    const rows = this.db
      .prepare(
        `SELECT m.* FROM messages_fts f JOIN messages m ON m.rowid = f.rowid
         WHERE messages_fts MATCH ? AND m.deleted = 0 ORDER BY m.created DESC LIMIT ?`,
      )
      .all(terms, limit) as Row[];
    return rows.map(toMessage);
  }

  routines(): Routine[] {
    return (this.db.prepare('SELECT data FROM routines WHERE deleted = 0 ORDER BY created').all() as Row[]).map((r) =>
      json<Routine>(r.data),
    );
  }

  routine(id: string): Routine | undefined {
    const r = this.db.prepare('SELECT data FROM routines WHERE id = ? AND deleted = 0').get(id) as Row | undefined;
    return r ? json<Routine>(r.data) : undefined;
  }

  cards(): Card[] {
    return (this.db.prepare('SELECT data FROM cards WHERE deleted = 0 ORDER BY created').all() as Row[]).map((r) =>
      json<Card>(r.data),
    );
  }

  records(kind?: string): RecordItem[] {
    const rows = kind
      ? this.db.prepare('SELECT data FROM records WHERE deleted = 0 AND kind = ? ORDER BY created DESC').all(kind)
      : this.db.prepare('SELECT data FROM records WHERE deleted = 0 ORDER BY created DESC').all();
    return (rows as Row[]).map((r) => json<RecordItem>(r.data));
  }

  record(id: string): RecordItem | undefined {
    const r = this.db.prepare('SELECT data FROM records WHERE id = ? AND deleted = 0').get(id) as Row | undefined;
    return r ? json<RecordItem>(r.data) : undefined;
  }

  card(id: string): Card | undefined {
    const r = this.db.prepare('SELECT data FROM cards WHERE id = ? AND deleted = 0').get(id) as Row | undefined;
    return r ? json<Card>(r.data) : undefined;
  }

  projects(): Project[] {
    return (this.db.prepare('SELECT data FROM projects WHERE deleted = 0 ORDER BY created').all() as Row[]).map((r) =>
      json<Project>(r.data),
    );
  }

  project(id: string): Project | undefined {
    const r = this.db.prepare('SELECT data FROM projects WHERE id = ? AND deleted = 0').get(id) as Row | undefined;
    return r ? json<Project>(r.data) : undefined;
  }

  progress(id: string): ProjectStatus | undefined {
    const r = this.db.prepare('SELECT data FROM progress WHERE id = ?').get(id) as Row | undefined;
    return r ? json<ProjectStatus>(r.data) : undefined;
  }

  // ---------------------------------------------------------------- project folders (local: each member's own clone)

  projectFolder(id: string): string | undefined {
    const r = this.db.prepare('SELECT folder FROM project_folders WHERE id = ?').get(id) as Row | undefined;
    return r ? String(r.folder) : undefined;
  }

  setProjectFolder(id: string, folder: string | undefined): void {
    if (folder) {
      this.db
        .prepare(
          'INSERT INTO project_folders (id, folder) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET folder = excluded.folder',
        )
        .run(id, folder);
    } else {
      this.db.prepare('DELETE FROM project_folders WHERE id = ?').run(id);
    }
  }

  // ---------------------------------------------------------------- jobs and sessions (local)

  saveJob(job: Job): void {
    this.db
      .prepare(
        `INSERT INTO jobs (id, channel_id, request_id, data, started) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
      )
      .run(job.id, job.channelId, job.requestId, JSON.stringify(job), job.started);
  }

  /** Jobs started since a moment, newest first (the Overview page). */
  jobsSince(since: number, limit = 3000): Job[] {
    return (
      this.db
        .prepare('SELECT data FROM jobs WHERE started >= ? ORDER BY started DESC LIMIT ?')
        .all(since, limit) as Row[]
    ).map((r) => json<Job>(r.data));
  }

  messagesSince(since: number): number {
    const r = this.db
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE created >= ? AND deleted = 0')
      .get(since) as Row;
    return Number(r.n);
  }

  /** Messages in a channel after a moment, and whether one of them mentions `@handle`. */
  unreadIn(channelId: string, after: number, handle?: string): { count: number; mention: boolean } {
    const r = this.db
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE channel_id = ? AND deleted = 0 AND created > ?')
      .get(channelId, after) as Row;
    const count = Number(r.n);
    if (!count || !handle) return { count, mention: false };
    // The handle holds only letters, digits and dashes, so it is safe inside the pattern.
    const hit = this.db
      .prepare('SELECT 1 FROM messages WHERE channel_id = ? AND deleted = 0 AND created > ? AND text LIKE ? LIMIT 1')
      .get(channelId, after, `%@${handle}%`);
    return { count, mention: Boolean(hit) };
  }

  job(id: string): Job | undefined {
    const r = this.db.prepare('SELECT data FROM jobs WHERE id = ?').get(id) as Row | undefined;
    return r ? json<Job>(r.data) : undefined;
  }

  jobsFor(requestIds: string[]): Job[] {
    if (requestIds.length === 0) return [];
    const marks = requestIds.map(() => '?').join(',');
    return (
      this.db
        .prepare(`SELECT data FROM jobs WHERE request_id IN (${marks}) ORDER BY started`)
        .all(...requestIds) as Row[]
    ).map((r) => json<Job>(r.data));
  }

  /**
   * Jobs this device was running when the app last closed: they cannot continue, so they end as stopped. Returns
   * them (a team workspace tells the others). Other members' jobs are theirs to end.
   */
  closeOrphanJobs(now: number, mine: (job: Job) => boolean = () => true): Job[] {
    const rows = this.db.prepare('SELECT data FROM jobs').all() as Row[];
    const closed: Job[] = [];
    for (const r of rows) {
      const job = json<Job>(r.data);
      if ((job.state === 'running' || job.state === 'attention') && mine(job)) {
        const ended: Job = { ...job, state: 'stopped', error: 'app_closed', ended: now };
        this.saveJob(ended);
        closed.push(ended);
      }
    }
    return closed;
  }

  session(agentId: string, channelId: string): string | undefined {
    const r = this.db
      .prepare('SELECT session_id FROM sessions WHERE agent_id = ? AND channel_id = ?')
      .get(agentId, channelId) as Row | undefined;
    return r ? String(r.session_id) : undefined;
  }

  setSession(agentId: string, channelId: string, sessionId: string | undefined): void {
    if (sessionId) {
      this.db
        .prepare(
          'INSERT INTO sessions (agent_id, channel_id, session_id) VALUES (?, ?, ?) ON CONFLICT (agent_id, channel_id) DO UPDATE SET session_id = excluded.session_id',
        )
        .run(agentId, channelId, sessionId);
    } else {
      this.db.prepare('DELETE FROM sessions WHERE agent_id = ? AND channel_id = ?').run(agentId, channelId);
    }
  }

  // ---------------------------------------------------------------- advisors' spending (local)

  addSpend(advisorId: string, day: string, tokens: number): void {
    this.db
      .prepare(
        'INSERT INTO advisor_spend (advisor_id, day, tokens) VALUES (?, ?, ?) ON CONFLICT (advisor_id, day) DO UPDATE SET tokens = tokens + excluded.tokens',
      )
      .run(advisorId, day, Math.max(0, Math.round(tokens)));
  }

  spend(day: string): Record<string, number> {
    const rows = this.db.prepare('SELECT advisor_id, tokens FROM advisor_spend WHERE day = ?').all(day) as Row[];
    return Object.fromEntries(rows.map((r) => [String(r.advisor_id), Number(r.tokens)]));
  }
}
