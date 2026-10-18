// Who may write what in a team workspace (PLAN.md 5.11 and the Phase 3 design). Every peer checks every event
// itself: a valid signature by a device with a membership certificate valid at the event's time, and a role that
// allows the event. Certificates are events too, written by admins; the workspace's first event names the root admin.

import { eventPayload, type SignedEvent, verifySignature } from './identity.js';
import type { WorkspaceStore } from './store.js';

export const ROLES = ['viewer', 'editor', 'admin'] as const;
export type Role = (typeof ROLES)[number];
const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

export interface Member {
  device: string;
  publicKey: string;
  name: string;
  role: Role;
  /** Milliseconds; the certificate is valid until then. */
  expires: number;
  /** When the member was removed (ms), if they were. */
  removed?: number;
  /** Their events up to this count were already known when they were removed; later ones are refused. */
  upTo?: number;
}

export interface Genesis {
  id: string;
  name: string;
  root: string;
  publicKey: string;
}

/** The wall-clock milliseconds inside a hybrid logical clock stamp. */
export const stampMs = (at: string) => Number.parseInt(at.split('.')[0] ?? '', 36);

export type Verdict = 'ok' | 'unknown_author' | 'bad_signature' | 'expired' | 'not_allowed' | 'wrong_workspace';

/** The lowest role that may write an event type; owner rules are checked separately. */
function minRole(type: string, data: Record<string, unknown>): Role | undefined {
  switch (type) {
    case 'message.posted':
    case 'message.edited':
    case 'message.deleted':
    case 'device.endpoint':
    case 'job.saved':
      return 'viewer';
    case 'card.saved':
    case 'card.deleted':
    case 'record.saved':
    case 'record.deleted':
    case 'goal.saved':
    case 'memory.saved':
    case 'agent.saved':
    case 'agent.deleted':
    case 'advisor.saved':
    case 'advisor.deleted':
      return 'editor';
    case 'channel.created':
      // An agent's own channel comes with the agent; other channels are an admin's.
      return data.kind === 'agent' ? 'editor' : 'admin';
    case 'channel.renamed':
    case 'channel.deleted':
    case 'member.certified':
    case 'member.removed':
      return 'admin';
    default:
      return undefined;
  }
}

export function roleAllows(role: Role, needed: Role): boolean {
  return RANK[role] >= RANK[needed];
}

export class Membership {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly workspace: string,
  ) {}

  genesis(): Genesis | undefined {
    const raw = this.store.meta('genesis');
    return raw ? (JSON.parse(raw) as Genesis) : undefined;
  }

  member(device: string): Member | undefined {
    return this.store.member(device);
  }

  /** Whether a device may act now with at least this role. */
  can(device: string, needed: Role, now = Date.now()): boolean {
    const m = this.member(device);
    return Boolean(m && !m.removed && m.expires > now && roleAllows(m.role, needed));
  }

  /** The author of an entity's first event (an agent's or advisor's owner, a message's writer). */
  private firstAuthor(entity: string): string | undefined {
    return this.store.firstAuthor(entity);
  }

  verify(e: SignedEvent): Verdict {
    const data = (e.data ?? {}) as Record<string, unknown>;
    const { sig, ...rest } = e;
    const payload = eventPayload(rest, this.workspace);

    // The first event: the root admin introduces the workspace and signs it with the key it names.
    if (e.type === 'workspace.created') {
      const known = this.genesis();
      if (data.id !== this.workspace || data.root !== e.author || typeof data.publicKey !== 'string')
        return 'not_allowed';
      if (known && known.root !== e.author) return 'not_allowed';
      return verifySignature(payload, sig, data.publicKey) ? 'ok' : 'bad_signature';
    }
    const genesis = this.genesis();
    if (!genesis) return 'unknown_author';

    // The root admin's own certificate, signed with the genesis key.
    if (e.type === 'member.certified' && e.author === genesis.root && data.device === genesis.root) {
      return data.publicKey === genesis.publicKey && verifySignature(payload, sig, genesis.publicKey)
        ? 'ok'
        : 'not_allowed';
    }

    const author = this.member(e.author);
    if (!author) return 'unknown_author';
    if (!verifySignature(payload, sig, author.publicKey)) return 'bad_signature';
    // Clock stamps are the author's own word, so validity is judged by this device's clock: an expired certificate
    // refuses for now (a renewal lets the same events in on a later sync), and a removed member's events count only
    // up to what the admin had from them at removal.
    if (author.removed !== undefined ? e.n > (author.upTo ?? 0) : author.expires <= Date.now()) return 'expired';
    // An agent's own channel belongs to the agent's owner: they make, rename and delete it with the agent.
    const agentChannel =
      e.type === 'channel.created'
        ? data.kind === 'agent'
          ? String(data.agentId ?? '')
          : undefined
        : e.type === 'channel.renamed' || e.type === 'channel.deleted'
          ? this.store.channel(String(data.id ?? ''))?.agentId
          : undefined;
    if (agentChannel !== undefined) {
      if (!roleAllows(author.role, 'editor')) return 'not_allowed';
      return this.firstAuthor(`agent:${agentChannel}`) === e.author ? 'ok' : 'not_allowed';
    }
    const needed = minRole(e.type, data);
    if (!needed || !roleAllows(author.role, needed)) return 'not_allowed';

    // Owners: an agent or advisor is changed only by whoever added it; a message only by its writer (or an admin
    // deleting it); an endpoint only by its own device.
    const entity = `${e.type.slice(0, e.type.indexOf('.'))}:${String(data.id ?? data.device ?? '')}`;
    const owner = this.firstAuthor(entity);
    switch (e.type) {
      case 'message.posted': {
        // People write as themselves; an agent's or advisor's message comes from its owner's device.
        const by = (data.author ?? {}) as { kind?: string; id?: string };
        if (by.kind === 'person' && by.id !== e.author) return 'not_allowed';
        if ((by.kind === 'agent' || by.kind === 'advisor') && this.firstAuthor(`${by.kind}:${by.id}`) !== e.author)
          return 'not_allowed';
        if (by.kind !== 'person' && by.kind !== 'agent' && by.kind !== 'advisor') return 'not_allowed';
        break;
      }
      case 'agent.saved':
      case 'agent.deleted':
      case 'advisor.saved':
      case 'advisor.deleted':
      case 'message.edited':
        if (owner && owner !== e.author) return 'not_allowed';
        break;
      case 'message.deleted':
        if (owner && owner !== e.author && author.role !== 'admin') return 'not_allowed';
        break;
      case 'device.endpoint':
        if (data.device !== e.author) return 'not_allowed';
        break;
      case 'job.saved':
        // A job runs on its agent's owner's computer, and only that computer reports it.
        if (this.firstAuthor(`agent:${String(data.agentId ?? '')}`) !== e.author) return 'not_allowed';
        break;
      case 'member.certified':
        if (!ROLES.includes(data.role as Role) || typeof data.publicKey !== 'string') return 'not_allowed';
        break;
    }
    return 'ok';
  }
}
