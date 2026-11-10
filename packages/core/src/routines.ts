// Routines (PLAN.md 5.16): a message a person asked to have posted for them at a set time on set days, for
// example "@test run the suite" every morning. It is that person's standing request, so it follows the rule that
// only a person starts work: the message is posted as its owner, on its owner's computer, while the app runs
// there, and agents treat it like any message that person writes.
import type { Routine } from '@lonca/protocol';
import type { WorkspaceStore } from './store.js';

/** How long after its time a routine still runs (the app was closed, or the computer asleep). */
export const CATCH_UP_MS = 60 * 60 * 1000;

const lastKey = (id: string) => `routine.last.${id}`;

/** The moment a routine is due on the day of `now` (local time); none when that day is not one of its days. */
export function dueOn(routine: Pick<Routine, 'at' | 'days'>, now: number): number | undefined {
  const d = new Date(now);
  if (routine.days.length > 0 && !routine.days.includes(d.getDay())) return undefined;
  const [h, m] = routine.at.split(':').map(Number);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.getTime();
}

/** The next moment a routine is due after `now`. */
export function nextRun(routine: Pick<Routine, 'at' | 'days'>, now: number): number {
  for (let day = 0; day <= 7; day += 1) {
    const due = dueOn(routine, now + day * 24 * 60 * 60 * 1000);
    if (due !== undefined && due > now) return due;
  }
  return now;
}

export interface RoutinesDeps {
  store: WorkspaceStore;
  deviceId: string;
  /** Posts the routine's message as its owner; false when it could not be posted (no right to, channel gone). */
  post(routine: Routine): boolean;
}

export class Routines {
  constructor(private readonly deps: RoutinesDeps) {}

  /** When this computer last posted a routine; a new routine counts from when it was made. */
  last(routine: Routine): number {
    return Number(this.deps.store.meta(lastKey(routine.id)) ?? routine.created);
  }

  /** Posts every routine of this computer that came due since it last ran (within the catch-up time). */
  tick(now = Date.now()): Routine[] {
    const ran: Routine[] = [];
    for (const r of this.deps.store.routines()) {
      if (!r.enabled || r.owner !== this.deps.deviceId) continue;
      const due = dueOn(r, now);
      if (due === undefined || now < due || now - due > CATCH_UP_MS || this.last(r) >= due) continue;
      // Marked first: a routine that fails to post is not tried again every minute.
      this.deps.store.setMeta(lastKey(r.id), String(now));
      if (this.deps.post(r)) ran.push(r);
    }
    return ran;
  }

  /** Posts a routine now, whatever its time. */
  run(routine: Routine, now = Date.now()): boolean {
    if (!this.deps.post(routine)) return false;
    this.deps.store.setMeta(lastKey(routine.id), String(now));
    return true;
  }
}
