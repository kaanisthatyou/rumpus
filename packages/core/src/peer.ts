// The peer API between members' apps (PLAN.md 6.5): plain HTTP on the Tailscale address (WireGuard encrypts the
// link), every request signed by the calling device's key and checked against the workspace's certificates.
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { canonical, type Signer, verifySignature } from './identity.js';

export const PEER_PORT = 47640;
const MAX_BODY = 4 * 1024 * 1024;
const SKEW_MS = 120_000;

/** Loopback, and Tailscale's addresses (100.64.0.0/10 and fd7a:115c:a1e0::/48). */
export function peerAddressAllowed(raw: string | undefined): boolean {
  const a = (raw ?? '').replace(/^::ffff:/, '').toLowerCase();
  if (a === '127.0.0.1' || a === '::1') return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(a);
  if (m) return Number(m[1]) === 100 && Number(m[2]) >= 64 && Number(m[2]) <= 127;
  return a.startsWith('fd7a:115c:a1e0:');
}

/**
 * An address this app may call another person's app at: an IP and a port, nothing else (no name to resolve, no
 * path), the IP in Tailscale's ranges. Loopback only when this app itself listens there (tests on one computer).
 * Addresses arrive in invites, friend codes and members' own events; without this, whoever writes one chooses
 * where every reader's app sends its requests (a host on their home network, a path of the writer's choice).
 */
export function peerTarget(address: unknown, loopback = false): { host: string; port: number } | undefined {
  if (typeof address !== 'string') return undefined;
  const m = /^(?:(\d{1,3}(?:\.\d{1,3}){3})|\[([0-9a-f:]{2,39})\]):(\d{1,5})$/i.exec(address);
  if (!m) return undefined;
  const host = (m[1] ?? m[2] ?? '').toLowerCase();
  const port = Number(m[3]);
  if (port < 1 || port > 65535) return undefined;
  const local = host === '127.0.0.1' || host === '::1';
  if (local ? !loopback : !peerAddressAllowed(host)) return undefined;
  return { host, port };
}

/** An address that is not another app's on Tailscale: refused before any connection is made. */
export class PeerAddressError extends Error {
  constructor() {
    super('address');
  }
}

const hash = (body: string) => createHash('sha256').update(body).digest('hex');

export function requestPayload(
  method: string,
  path: string,
  ws: string,
  device: string,
  time: string,
  body: string,
): string {
  return canonical({ v: 1, m: method, p: path, ws, d: device, t: time, b: hash(body) });
}

export interface PeerRequest {
  ws: string;
  device: string;
  path: string;
  body: unknown;
}

export interface PeerHandlers {
  /** The public key of a device allowed to call this workspace now, or undefined. */
  keyOf(ws: string, device: string): string | undefined;
  /** Routes that need no certificate (the join request); they check the body themselves. */
  open?: Set<string>;
  handle(req: PeerRequest): Promise<unknown>;
}

export class PeerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class PeerServer {
  private server: Server | undefined;

  constructor(private readonly handlers: PeerHandlers) {}

  async listen(host: string, port: number): Promise<string> {
    const server = createServer((req, res) => void this.serve(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve());
    });
    this.server = server;
    const a = server.address() as AddressInfo;
    return `${host.includes(':') ? `[${host}]` : host}:${a.port}`;
  }

  close(): void {
    this.server?.close();
    this.server = undefined;
  }

  private send(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  }

  private async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!peerAddressAllowed(req.socket.remoteAddress)) return this.send(res, 403, { error: 'address' });
      if (req.method !== 'POST') return this.send(res, 405, { error: 'method' });
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > MAX_BODY) return this.send(res, 413, { error: 'too_large' });
        chunks.push(c as Buffer);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      const path = (req.url ?? '').split('?')[0] ?? '';
      const ws = String(req.headers['x-lonca-ws'] ?? '');
      const device = String(req.headers['x-lonca-device'] ?? '');
      const time = String(req.headers['x-lonca-time'] ?? '');
      const sig = String(req.headers['x-lonca-sig'] ?? '');
      if (!this.handlers.open?.has(path)) {
        if (Math.abs(Date.now() - Number(time)) > SKEW_MS) return this.send(res, 401, { error: 'time' });
        const key = this.handlers.keyOf(ws, device);
        if (!key || !verifySignature(requestPayload('POST', path, ws, device, time, raw), sig, key)) {
          return this.send(res, 401, { error: 'not_member' });
        }
      }
      let body: unknown;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return this.send(res, 400, { error: 'json' });
      }
      const result = await this.handlers.handle({ ws, device, path, body });
      this.send(res, 200, result ?? {});
    } catch (e) {
      if (e instanceof PeerError) this.send(res, e.status, { error: e.message });
      else this.send(res, 500, { error: 'internal' });
    }
  }
}

/** Calls other members' apps, signing every request. */
export class PeerClient {
  constructor(
    private readonly deviceId: string,
    private readonly signer: Signer,
    private readonly timeoutMs = 15_000,
    /** This app listens on loopback itself (tests): other apps may be called there too. */
    private readonly loopback = false,
  ) {}

  async call(address: string, path: string, ws: string, body: unknown): Promise<unknown> {
    if (!peerTarget(address, this.loopback)) throw new PeerAddressError();
    const raw = JSON.stringify(body ?? {});
    const time = String(Date.now());
    const sig = await this.signer.sign(requestPayload('POST', path, ws, this.deviceId, time, raw));
    const res = await fetch(`http://${address}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-lonca-ws': ws,
        'x-lonca-device': this.deviceId,
        'x-lonca-time': time,
        'x-lonca-sig': sig,
      },
      body: raw,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok)
      throw new PeerError(
        res.status,
        (() => {
          try {
            return String((JSON.parse(text) as { error?: string }).error ?? res.status);
          } catch {
            return String(res.status);
          }
        })(),
      );
    return text ? JSON.parse(text) : {};
  }
}
