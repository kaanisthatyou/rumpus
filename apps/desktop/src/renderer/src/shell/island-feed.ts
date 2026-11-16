// What the island's feed holds (Island.tsx): turns in the order they began. A person's message is one turn; an
// agent's job is one turn that keeps its place from start to answer, however often it changes. Pure functions,
// so the order can be tested without a window.
import type { JobState } from '@lonca/protocol';

/** Turns kept; older ones leave as new ones come. */
export const KEEP = 40;

export interface MineTurn {
  kind: 'me';
  key: string;
  /** The message's id: a job started by it names it as its request. */
  id: string;
  at: number;
  /** Where it went (`#genel`, `@claude`), kept with it: another workspace may be open later. */
  where: string;
  text: string;
}

export interface AgentTurn {
  kind: 'agent';
  key: string;
  at: number;
  jobId?: string;
  /** The message that started the job. */
  requestId?: string;
  who: string;
  where: string;
  state?: JobState;
  started?: number;
  /** Finished text blocks the agent wrote while working, oldest first. */
  lines: string[];
  /** The text block being written now. */
  live?: string;
  answer?: string;
}

export type Turn = MineTurn | AgentTurn;

/** Puts a turn in its place by time; a turn with the same key is replaced where it stands. */
function put(list: Turn[], turn: Turn): Turn[] {
  const at = list.findIndex((x) => x.key === turn.key);
  if (at >= 0) return list.map((x, i) => (i === at ? turn : x));
  let i = list.length;
  while (i > 0 && (list[i - 1]?.at ?? 0) > turn.at) i--;
  return [...list.slice(0, i), turn, ...list.slice(i)].slice(-KEEP);
}

const jobKey = (jobId: string) => `j:${jobId}`;

function jobTurn(list: Turn[], jobId: string): AgentTurn | undefined {
  const found = list.find((x) => x.key === jobKey(jobId));
  return found?.kind === 'agent' ? found : undefined;
}

export function addMine(list: Turn[], m: { id: string; at: number; where: string; text: string }): Turn[] {
  return put(list, { kind: 'me', key: `m:${m.id}`, id: m.id, at: m.at, where: m.where, text: m.text });
}

/** A job of this person's changed: its turn appears at the time it started and stays there. */
export function updateJob(
  list: Turn[],
  job: { id: string; state: JobState; started: number; requestId?: string; live?: string },
  who: string,
  where: string,
): Turn[] {
  const before = jobTurn(list, job.id);
  const running = job.state === 'running';
  const turn: AgentTurn = {
    ...(before ?? {
      kind: 'agent',
      key: jobKey(job.id),
      at: job.started,
      jobId: job.id,
      ...(job.requestId ? { requestId: job.requestId } : {}),
      who,
      where,
      lines: [],
    }),
    state: job.state,
    started: job.started,
  };
  // An event can come before the island knows the workspace: a name learned later fills what was blank.
  if (!turn.who && who) turn.who = who;
  if (!turn.where && where) turn.where = where;
  if (running && job.live) turn.live = job.live;
  else if (!running) delete turn.live;
  return put(list, turn);
}

/** The text blocks a job's transcript holds so far. */
export function setLines(list: Turn[], jobId: string, lines: string[]): Turn[] {
  const before = jobTurn(list, jobId);
  if (!before) return list;
  const clean = lines.filter(Boolean);
  if (clean.length === before.lines.length && clean.every((l, i) => l === before.lines[i])) return list;
  return put(list, { ...before, lines: clean });
}

/**
 * An agent's answer: it lands in its job's turn, or stands alone when the job is not known here. A message that
 * went into a job already running (no job of its own) is what the answer answers: the turn moves below it, to
 * the answer's time. Jobs that each have their message stay where they began.
 */
export function addAnswer(
  list: Turn[],
  m: { id: string; jobId?: string; at: number; who: string; where: string; text: string },
): Turn[] {
  const before = m.jobId ? jobTurn(list, m.jobId) : undefined;
  if (before) {
    const { live: _done, ...known } = before;
    const rest = { ...known, who: known.who || m.who, where: known.where || m.where };
    const since = list.slice(list.indexOf(before) + 1);
    const asked = new Set(list.flatMap((x) => (x.kind === 'agent' && x.requestId ? [x.requestId] : [])));
    const steered = since.filter((x) => x.kind === 'me' && !asked.has(x.id));
    if (steered.length === 0) return put(list, { ...rest, answer: m.text });
    // The answer's time, but never above that message (another computer's clock may run behind).
    const at = Math.max(m.at, ...steered.map((x) => x.at + 1));
    return put(
      list.filter((x) => x !== before),
      { ...rest, at, answer: m.text },
    );
  }
  if (!m.text || list.some((x) => x.key === `a:${m.id}`)) return list;
  return put(list, {
    kind: 'agent',
    key: `a:${m.id}`,
    at: m.at,
    ...(m.jobId ? { jobId: m.jobId } : {}),
    who: m.who,
    where: m.where,
    lines: [],
    answer: m.text,
  });
}

/**
 * How a turn reads: the line in view (the answer, or what is being written now) and the notes before it. The
 * answer is usually also the last block of the transcript; it is not repeated among the notes.
 */
export function view(turn: AgentTurn): { main?: string; notes: string[] } {
  const main = turn.answer ?? turn.live ?? turn.lines.at(-1);
  const notes = main === undefined ? turn.lines : turn.lines.filter((l) => l !== main);
  // While working, the last finished block is in view itself when nothing newer is being written.
  return main === undefined ? { notes } : { main, notes };
}
