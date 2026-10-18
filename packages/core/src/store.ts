// One workspace in one SQLite file (Node's built-in node:sqlite, no native module to build).
// Every change is an event in an append-only log first, then applied to the tables; Phase 3 syncs the log.
// Running jobs are local state of this machine and live in their own table, outside the log.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Advisor, Agent, Author, Card, Channel, Goal, Job, Message, RecordItem } from '@lonca/protocol';
import { Clock, newId } from './ids.js';

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
  | { type: 'message.posted'; data: Message }
  | { type: 'message.edited'; data: { id: string; text: string; edited: number } }
  | { type: 'message.deleted'; data: { id: string } }
  | { type: 'card.saved'; data: Card }
  | { type: 'card.deleted'; data: { id: string } }
  | { type: 'record.saved'; data: RecordItem }
  | { type: 'record.deleted'; data: { id: string } };

const json = <T>(text: unknown): T => JSON.parse(String(text)) as T;

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
    this.clock = new Clock(deviceId);
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
  commit(event: WorkspaceEvent): void {
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare('INSERT INTO events (id, at, author, type, data) VALUES (?, ?, ?, ?, ?)')
        .run(newId(), this.clock.now(), this.deviceId, event.type, JSON.stringify(event.data));
      this.apply(event);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
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
            'INSERT OR IGNORE INTO messages (id, channel_id, author, text, created, job_id, refs) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            m.id,
            m.channelId,
            JSON.stringify(m.author),
            m.text,
            m.created,
            m.jobId ?? null,
            m.refs?.length ? JSON.stringify(m.refs) : null,
          );
        return;
      }
      case 'message.edited':
        this.db
          .prepare('UPDATE messages SET text = ?, edited = ? WHERE id = ?')
          .run(e.data.text, e.data.edited, e.data.id);
        return;
      case 'message.deleted':
        this.db.prepare("UPDATE messages SET deleted = 1, text = '' WHERE id = ?").run(e.data.id);
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
    }
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

  // ---------------------------------------------------------------- jobs and sessions (local)

  saveJob(job: Job): void {
    this.db
      .prepare(
        `INSERT INTO jobs (id, channel_id, request_id, data, started) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
      )
      .run(job.id, job.channelId, job.requestId, JSON.stringify(job), job.started);
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

  /** Jobs that were running when the app last closed: they cannot continue, so they end as stopped. */
  closeOrphanJobs(now: number): void {
    const rows = this.db.prepare('SELECT data FROM jobs').all() as Row[];
    for (const r of rows) {
      const job = json<Job>(r.data);
      if (job.state === 'running' || job.state === 'attention') {
        this.saveJob({ ...job, state: 'stopped', error: 'app_closed', ended: now });
      }
    }
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
