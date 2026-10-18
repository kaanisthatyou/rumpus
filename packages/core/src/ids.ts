import { randomBytes } from 'node:crypto';

/** Time-ordered ids: 10 chars of milliseconds in base 36, then 12 random chars. */
export function newId(now = Date.now()): string {
  return now.toString(36).padStart(10, '0') + randomBytes(9).toString('base64url').slice(0, 12);
}

/**
 * Hybrid logical clock (what Fabrika uses for its chat): sortable stamps that stay in order on one device even
 * when the wall clock steps back, and break ties between devices by device id.
 */
export class Clock {
  private last = 0;
  private counter = 0;

  constructor(private readonly deviceId: string) {}

  /** A stamp seen from another device: later stamps from here sort after it. */
  observe(stamp: string): void {
    const [ms36, c36] = stamp.split('.');
    const ms = Number.parseInt(ms36 ?? '', 36);
    const counter = Number.parseInt(c36 ?? '', 36);
    if (!Number.isFinite(ms) || !Number.isFinite(counter)) return;
    if (ms > this.last) {
      this.last = ms;
      this.counter = counter;
    } else if (ms === this.last && counter > this.counter) {
      this.counter = counter;
    }
  }

  now(wall = Date.now()): string {
    if (wall > this.last) {
      this.last = wall;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
    return `${this.last.toString(36).padStart(10, '0')}.${this.counter.toString(36).padStart(4, '0')}.${this.deviceId}`;
  }
}
