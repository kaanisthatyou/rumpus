// The keeper: Rumpus's core with no window and no agents, on a machine that stays up (PLAN.md 6.5). It is a member
// like any other: it joins with an invite an admin approves, holds the whole workspace, and syncs with whoever is
// online, so members who are rarely online together still get each other's messages. It is not a relay or a
// hosted service: it runs on a member's own machine, sees only what that member's certificate lets it see, and
// every event it passes on is checked against its author's signature by the computer that takes it.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Core, FileSigner } from '@lonca/core';
import { BRAND, type Frame, type WorkspaceState, type WorkspaceSummary } from '@lonca/protocol';

export interface KeeperOptions {
  home: string;
  /** Listen here instead of on the Tailscale address (tests, a second keeper on one machine). */
  peerHost?: string;
  peerPort?: number;
}

/** Where a keeper keeps its data unless told otherwise. */
export function defaultHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.LONCA_HOME || join(homedir(), `.${BRAND.slug}-keeper`);
}

export interface Keeper {
  core: Core;
  call<T>(method: string, params?: unknown): Promise<T>;
  stop(): void;
}

export class KeeperError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/**
 * One keeper per data folder: a second one (`join` while the service runs) would fight over the port and the
 * databases. Returns how to let go.
 */
export function takeLock(home: string): () => void {
  const file = join(home, 'keeper.pid');
  const held = Number.parseInt(existsSync(file) ? readFileSync(file, 'utf8') : '', 10);
  if (held > 0 && held !== process.pid) {
    let alive = true;
    try {
      process.kill(held, 0);
    } catch (e) {
      // EPERM: it runs, under another user.
      alive = (e as NodeJS.ErrnoException).code === 'EPERM';
    }
    if (alive) throw new KeeperError('busy', `another keeper uses ${home} (process ${held}); it is stopped first`);
  }
  mkdirSync(home, { recursive: true });
  writeFileSync(file, String(process.pid));
  return () => {
    try {
      if (readFileSync(file, 'utf8') === String(process.pid)) rmSync(file);
    } catch {
      // already gone
    }
  };
}

export function openKeeper(opts: KeeperOptions): Keeper {
  const core = new Core({
    appDir: opts.home,
    language: 'en',
    signer: new FileSigner(join(opts.home, 'identity.json')),
    ...(opts.peerHost ? { peer: { host: opts.peerHost, port: opts.peerPort ?? 0 } } : {}),
  });
  let id = 0;
  return {
    core,
    async call<T>(method: string, params?: unknown): Promise<T> {
      const reply: Frame = await core.answer({ id: ++id, method, ...(params === undefined ? {} : { params }) });
      if ('error' in reply && reply.error) throw new KeeperError(reply.error.code, reply.error.message);
      return (reply as { result: T }).result;
    },
    stop: () => core.shutdown(),
  };
}

export interface MemberLine {
  name: string;
  role: string;
  online?: boolean;
  me?: boolean;
}

export interface WorkspaceLine {
  id: string;
  name: string;
  state?: string;
  members: MemberLine[];
  address?: string;
}

/** Every team workspace this keeper is in, with who is reachable now. */
export async function snapshot(k: Keeper): Promise<WorkspaceLine[]> {
  const list = await k.call<WorkspaceSummary[]>('workspaces.list');
  const out: WorkspaceLine[] = [];
  for (const w of list.filter((w) => w.kind === 'team')) {
    if (w.state) {
      out.push({ id: w.id, name: w.name, state: w.state, members: [] });
      continue;
    }
    const s = await k.call<WorkspaceState>('workspaces.open', { id: w.id });
    out.push({
      id: w.id,
      name: w.name,
      members: (s.members ?? []).map((m) => ({
        name: m.name,
        role: m.role,
        ...(m.online !== undefined ? { online: m.online } : {}),
        ...(m.me ? { me: true } : {}),
      })),
      ...(s.address ? { address: s.address } : {}),
    });
  }
  return out;
}

/** One line per workspace, for the log: what changes is worth a line, the rest is not repeated. */
export function describe(lines: WorkspaceLine[]): string[] {
  return lines.map((w) => {
    if (w.state) return `${w.name}: ${w.state}`;
    const others = w.members.filter((m) => !m.me);
    const online = others.filter((m) => m.online).map((m) => m.name);
    return `${w.name}: ${others.length} other member${others.length === 1 ? '' : 's'}, online: ${online.length ? online.join(', ') : 'none'}${w.address ? ` (listening on ${w.address})` : ''}`;
  });
}

/** What the files say, without starting the core (a running keeper holds the port and the databases). */
export function readStatus(home: string): {
  device?: string;
  key?: string;
  workspaces: { id: string; name: string; state?: string }[];
} {
  const json = (file: string) => {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  };
  const device = json(join(home, 'device.json'))?.id;
  const publicKey = json(join(home, 'identity.json'))?.publicKey;
  const settings = json(join(home, 'settings.json'));
  const dataDir = typeof settings?.dataDir === 'string' && settings.dataDir ? settings.dataDir : join(home, 'data');
  const file = join(dataDir, 'workspaces.json');
  const list = existsSync(file) ? ((json(file)?.list as Record<string, unknown>[] | undefined) ?? []) : [];
  return {
    ...(typeof device === 'string' ? { device } : {}),
    ...(typeof publicKey === 'string'
      ? { key: createHash('sha256').update(publicKey).digest('hex').slice(0, 16) }
      : {}),
    workspaces: list.map((t) => ({
      id: String(t.id),
      name: String(t.name),
      ...(t.joining ? { state: 'joining' } : t.denied ? { state: 'denied' } : {}),
    })),
  };
}

export type Command =
  | { kind: 'join'; code: string; name?: string; untilJoined?: boolean }
  | { kind: 'run' }
  | { kind: 'status' }
  | { kind: 'help' }
  | { kind: 'version' };

export function parseArgs(argv: string[]): Command {
  const [verb, ...rest] = argv;
  switch (verb) {
    case 'join': {
      let name: string | undefined;
      let untilJoined = false;
      const words: string[] = [];
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i] as string;
        if (a === '--name') {
          name = rest[++i];
          if (!name) throw new KeeperError('usage', '--name needs a value');
        } else if (a.startsWith('--name=')) name = a.slice('--name='.length);
        else if (a === '--until-joined') untilJoined = true;
        else words.push(a);
      }
      if (words.length !== 1) throw new KeeperError('usage', 'join takes one invite code or link');
      return {
        kind: 'join',
        code: words[0] as string,
        ...(name ? { name } : {}),
        ...(untilJoined ? { untilJoined: true } : {}),
      };
    }
    case 'run':
    case undefined:
      if (rest.length) throw new KeeperError('usage', `run takes no arguments`);
      return { kind: 'run' };
    case 'status':
      return { kind: 'status' };
    case 'version':
    case '--version':
    case '-v':
      return { kind: 'version' };
    case 'help':
    case '--help':
    case '-h':
      return { kind: 'help' };
    default:
      throw new KeeperError('usage', `unknown command: ${verb}`);
  }
}

export const USAGE = `${BRAND.slug}-keeper: an always-on member for ${BRAND.name} team workspaces

It holds the workspace on a machine that stays up and syncs with whoever is online, so members who are rarely
online together still get each other's messages. It runs no agents and has no window.

Usage:
  ${BRAND.slug}-keeper join <invite code or link> [--name <name>] [--until-joined]
                                    ask to join, then keep running (or stop once joined)
  ${BRAND.slug}-keeper run                                          keep the workspaces it is in
  ${BRAND.slug}-keeper status                                       what it is in (reads files only)

An admin makes the invite (Viewer is enough) and approves the request in ${BRAND.name}.
Other members reach the keeper on its Tailscale address, TCP port 47640.

Environment:
  LONCA_HOME       its data folder (default ~/.${BRAND.slug}-keeper)
  LONCA_PEER_HOST  listen on this address instead of the Tailscale one
  LONCA_PEER_PORT  and this port`;
