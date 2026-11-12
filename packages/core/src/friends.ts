// Friends (PLAN.md 5.20): people added outside any workspace. A friend code names a person's computer (its
// device, its public key, its address on Tailscale); a request goes straight to that computer, and an accepted
// one becomes a workspace of two. This file keeps the requests on their way; the conversations themselves are
// ordinary synced workspaces.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CoreError, friendCode, friendPayload, LIMITS, oneLine } from '@lonca/protocol';

/** A request someone sent to this computer. */
export interface FriendAsk {
  id: string;
  device: string;
  publicKey: string;
  name: string;
  address: string;
  at: number;
  state: 'pending' | 'accepted' | 'denied';
  /** Once accepted: the workspace of the conversation, for the asker to take. */
  ws?: string;
}

/** A request this computer sent, until the other answers. */
export interface FriendSent {
  device: string;
  publicKey: string;
  name: string;
  address: string;
  request: string;
  at: number;
}

export interface FriendCard {
  device: string;
  publicKey: string;
  name: string;
  address: string;
}

const DEVICE = /^[\w-]{8,64}$/;
const ADDRESS = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]{2,39}\]):\d{1,5}$/i;
/** Requests kept waiting at most; more are refused until some are answered. */
export const MAX_ASKS = 20;

/** A device, a key, a name and an address as a friend request or a friend code carries them; undefined when off. */
export function friendCard(raw: {
  device?: unknown;
  publicKey?: unknown;
  name?: unknown;
  address?: unknown;
}): FriendCard | undefined {
  const { device, publicKey, name, address } = raw;
  if (typeof device !== 'string' || !DEVICE.test(device)) return undefined;
  if (typeof publicKey !== 'string' || publicKey.length < 40 || publicKey.length > 200) return undefined;
  if (typeof address !== 'string' || !ADDRESS.test(address)) return undefined;
  return {
    device,
    publicKey,
    name: (typeof name === 'string' ? oneLine(name).slice(0, LIMITS.personName) : '') || '?',
    address,
  };
}

export function makeFriendCode(me: FriendCard): string {
  const payload = JSON.stringify({ d: me.device, k: me.publicKey, n: me.name, a: [me.address] });
  return friendCode(Buffer.from(payload).toString('base64url'));
}

/** Who a pasted friend code names; anything else is `bad_friend_code`. */
export function readFriendCode(code: unknown): FriendCard {
  const payload = typeof code === 'string' ? friendPayload(code) : undefined;
  if (!payload) throw new CoreError('bad_friend_code');
  try {
    const raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    const card = friendCard({
      device: raw.d,
      publicKey: raw.k,
      name: raw.n,
      address: Array.isArray(raw.a) ? raw.a[0] : undefined,
    });
    if (card) return card;
  } catch {
    // not JSON
  }
  throw new CoreError('bad_friend_code');
}

export interface FriendData {
  asks: FriendAsk[];
  sent: FriendSent[];
  /** The person opened their friends once: from then on the app listens for requests whenever it runs. */
  on: boolean;
}

/** The requests on their way, in `<app>/friends.json`. A damaged file reads as empty. */
export class FriendRequests {
  constructor(private readonly file: string) {}

  read(): FriendData {
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as { asks?: unknown; sent?: unknown; on?: unknown };
      const asks = (Array.isArray(data.asks) ? data.asks : []).flatMap((a: Partial<FriendAsk>) => {
        const card = friendCard(a);
        if (!card || typeof a.id !== 'string') return [];
        const state: FriendAsk['state'] = a.state === 'accepted' || a.state === 'denied' ? a.state : 'pending';
        return [{ ...card, id: a.id, at: Number(a.at) || 0, state, ...(typeof a.ws === 'string' ? { ws: a.ws } : {}) }];
      });
      const sent = (Array.isArray(data.sent) ? data.sent : []).flatMap((s: Partial<FriendSent>) => {
        const card = friendCard(s);
        return card && typeof s.request === 'string' ? [{ ...card, request: s.request, at: Number(s.at) || 0 }] : [];
      });
      return { asks, sent, on: data.on === true };
    } catch {
      return { asks: [], sent: [], on: false };
    }
  }

  write(data: FriendData): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    // Answered requests are kept for a while so the asker can still hear the answer; the oldest go first.
    const asks = [...data.asks].sort((a, b) => b.at - a.at).slice(0, MAX_ASKS * 3);
    writeFileSync(tmp, JSON.stringify({ v: 1, on: data.on, asks, sent: data.sent.slice(0, MAX_ASKS) }, null, 1));
    renameSync(tmp, this.file);
  }
}
