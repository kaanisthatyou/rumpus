// Keeps a team workspace's copies the same (PLAN.md 6.5): own events are signed, then pushed to online peers;
// every round each peer compares heads with every known peer and takes what it lacks. Whatever comes in is checked
// event by event; events whose author's certificate has not arrived yet are tried again once the rest is in.
import { eventPayload, type SignedEvent, type Signer } from './identity.js';
import type { Membership } from './membership.js';
import type { WorkspaceStore } from './store.js';

export interface PeerCaller {
  call(address: string, path: string, ws: string, body: unknown): Promise<unknown>;
}

export interface SyncDeps {
  ws: string;
  deviceId: string;
  store: WorkspaceStore;
  membership: Membership;
  signer: Signer;
  peers: PeerCaller;
  /** Events taken from peers, after they changed the tables. */
  onIngested(events: SignedEvent[]): void;
  /** Peers answered or not: who is reachable now. */
  onReach?(device: string, ok: boolean): void;
  /** Addresses to try when no member has one yet: the inviter's, for a device that just joined. */
  seeds?(): string[];
  /** Runs before each round (an admin renews certificates there). */
  beforeRound?(): void;
  roundMs?: number;
}

const PAGE = 500;

export class Sync {
  private timer: NodeJS.Timeout | undefined;
  private kicked: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;
  /** Rejected events by reason, for diagnosis. */
  readonly refused: Record<string, number> = {};

  constructor(private readonly deps: SyncDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.round(), this.deps.roundMs ?? 30_000);
    this.timer.unref?.();
    this.kick();
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
    clearTimeout(this.kicked);
  }

  /** Something changed here: sign it and tell peers soon. */
  kick(delay = 300): void {
    if (this.stopped) return;
    clearTimeout(this.kicked);
    this.kicked = setTimeout(() => void this.round(), delay);
    this.kicked.unref?.();
  }

  async signPending(): Promise<void> {
    const { store, signer, ws } = this.deps;
    if (!signer.publicKey()) return;
    for (let batch = store.unsigned(); batch.length > 0; batch = store.unsigned()) {
      for (const e of batch) store.setSignature(e.id, await signer.sign(eventPayload(e, ws)));
    }
  }

  /** Takes a peer's events: the ones that check out change the tables; returns those. */
  receive(events: SignedEvent[]): SignedEvent[] {
    const { store, membership } = this.deps;
    let left = events.filter((e) => e && typeof e.id === 'string' && typeof e.sig === 'string');
    const applied: SignedEvent[] = [];
    // Certificates may come after the events they allow: go round until nothing more can be taken.
    for (let progress = true; progress && left.length > 0; ) {
      progress = false;
      const next: SignedEvent[] = [];
      for (const e of left) {
        const verdict = membership.verify(e);
        if (verdict === 'ok') {
          if (store.ingest(e)) applied.push(e);
          progress = true;
        } else if (verdict === 'unknown_author') {
          next.push(e);
        } else {
          this.refused[verdict] = (this.refused[verdict] ?? 0) + 1;
        }
      }
      left = next;
    }
    if (applied.length) this.deps.onIngested(applied);
    return applied;
  }

  /** A peer asks for what it lacks. */
  serve(theirs: Record<string, number>): { events: SignedEvent[]; heads: Record<string, number> } {
    return { events: this.deps.store.eventsAfter(theirs ?? {}, PAGE), heads: this.deps.store.heads() };
  }

  /** One exchange with one peer: take what it has, give what it lacks. */
  async syncWith(address: string): Promise<void> {
    const { store, peers, ws } = this.deps;
    for (let page = 0; page < 20; page++) {
      const answer = (await peers.call(address, '/v1/sync', ws, { heads: store.heads() })) as {
        events?: SignedEvent[];
        heads?: Record<string, number>;
      };
      const events = Array.isArray(answer?.events) ? answer.events : [];
      this.receive(events);
      const theirs = answer?.heads ?? {};
      const give = store.eventsAfter(theirs, PAGE);
      if (give.length) await peers.call(address, '/v1/push', ws, { events: give });
      if (events.length < PAGE) return;
    }
  }

  /** Signs what is new here, then syncs with every other member that has an address. */
  async round(): Promise<void> {
    if (this.stopped) return;
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        this.deps.beforeRound?.();
        await this.signPending();
        const { store, deviceId } = this.deps;
        const endpoints = store.endpoints();
        let reached = 0;
        for (const m of store.members()) {
          // A removed member still hears about it for a day; after that nobody syncs with them.
          if (m.device === deviceId || (m.removed !== undefined && Date.now() - m.removed > 24 * 60 * 60 * 1000))
            continue;
          for (const address of endpoints[m.device] ?? []) {
            try {
              await this.syncWith(address);
              this.deps.onReach?.(m.device, true);
              reached += 1;
              break;
            } catch {
              this.deps.onReach?.(m.device, false);
            }
          }
        }
        if (reached === 0) {
          for (const address of this.deps.seeds?.() ?? []) {
            try {
              await this.syncWith(address);
              // What came in may give members' addresses: one more round with them, soon.
              if (Object.keys(store.endpoints()).length > Object.keys(endpoints).length) this.kick(50);
              break;
            } catch {
              // the seed is not reachable now
            }
          }
        }
      } finally {
        this.running = undefined;
      }
    })();
    return this.running;
  }
}
