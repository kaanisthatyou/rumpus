// The phone companion (PLAN.md 5.12): the PC serves the same UI to its owner's phones over Tailscale. Everything
// still runs on the PC. Each phone is paired once with a one-time code from a QR and gets its own key, so one phone
// can be cut off without the others. The server listens on loopback only; `tailscale serve` puts HTTPS in front.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import type { Frame } from '@lonca/protocol';

export const PHONE_PORT = 47620;
const PAIR_MS = 10 * 60 * 1000;
const COOKIE = 'lonca_phone';
const MAX_BODY = 12 * 1024 * 1024;

export interface PhoneInfo {
  id: string;
  name: string;
  created: number;
  lastSeen?: number;
}

interface Stored extends PhoneInfo {
  hash: string;
}

/** What the phone server needs from the core: answer one request, and a stream of events. */
export interface PhoneHost {
  answer(frame: unknown): Promise<Frame>;
  subscribe(send: (frame: Frame) => void): () => void;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export class PhoneServer {
  private server: Server | undefined;
  private readonly codes = new Map<string, number>();

  constructor(
    private readonly file: string,
    private readonly host: PhoneHost,
    private readonly webDir: string | undefined,
  ) {}

  // ---------------------------------------------------------------- phones

  private load(): Stored[] {
    if (!existsSync(this.file)) return [];
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as { phones?: Stored[] };
      return Array.isArray(data.phones) ? data.phones : [];
    } catch {
      return [];
    }
  }

  private save(list: Stored[]): void {
    writeFileSync(`${this.file}.tmp`, JSON.stringify({ v: 1, phones: list }, null, 1), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }

  phones(): PhoneInfo[] {
    return this.load().map(({ hash: _h, ...p }) => p);
  }

  /** A one-time code for a QR, valid for ten minutes. */
  pairingCode(): { code: string; expires: number } {
    const code = randomBytes(12).toString('base64url');
    const expires = Date.now() + PAIR_MS;
    this.codes.set(code, expires);
    return { code, expires };
  }

  revoke(id: string): void {
    this.save(this.load().filter((p) => p.id !== id));
  }

  /** The phone a request comes from, by its key (cookie, or a header for home-screen apps without cookies). */
  private phoneOf(req: IncomingMessage, url: URL): Stored | undefined {
    const header = req.headers['x-lonca-phone'];
    const cookie = /(?:^|;\s*)lonca_phone=([\w-]+)/.exec(String(req.headers.cookie ?? ''))?.[1];
    // An event stream cannot send headers: a home-screen app without cookies names its key in the address.
    const query = url.pathname === '/api/events' ? (url.searchParams.get('k') ?? undefined) : undefined;
    const token = typeof header === 'string' && header ? header : (cookie ?? query);
    if (!token) return undefined;
    const hash = sha256(token);
    const list = this.load();
    const phone = list.find((p) => same(p.hash, hash));
    if (phone && (!phone.lastSeen || Date.now() - phone.lastSeen > 60_000)) {
      phone.lastSeen = Date.now();
      this.save(list);
    }
    return phone;
  }

  // ---------------------------------------------------------------- HTTP

  async listen(port = PHONE_PORT): Promise<number> {
    const server = createServer((req, res) => void this.serve(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve());
    });
    this.server = server;
    return (server.address() as AddressInfo).port;
  }

  close(): void {
    this.server?.close();
    this.server = undefined;
  }

  get running(): boolean {
    return this.server !== undefined;
  }

  private json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    res
      .writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers })
      .end(JSON.stringify(body));
  }

  private async body(req: IncomingMessage): Promise<unknown> {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_BODY) throw new Error('too_large');
      chunks.push(c as Buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  }

  /** Writes: same origin, and a header a cross-site form or image cannot send. */
  private trusted(req: IncomingMessage): boolean {
    if (req.headers['x-lonca'] !== '1') return false;
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }

  private async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://phone');
      if (url.pathname === '/api/ping') return this.json(res, 200, { ok: true });
      if (url.pathname === '/api/pair' && req.method === 'POST') {
        if (!this.trusted(req)) return this.json(res, 403, { error: 'origin' });
        const { code, name } = (await this.body(req)) as { code?: unknown; name?: unknown };
        const expires = typeof code === 'string' ? this.codes.get(code) : undefined;
        if (!expires || expires < Date.now()) return this.json(res, 403, { error: 'code' });
        this.codes.delete(String(code));
        const token = randomBytes(24).toString('base64url');
        const phone: Stored = {
          id: randomBytes(6).toString('base64url'),
          name: String(name ?? '').slice(0, 40) || 'Telefon',
          created: Date.now(),
          hash: sha256(token),
        };
        this.save([...this.load(), phone]);
        const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
        return this.json(
          res,
          200,
          { token },
          { 'set-cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure}` },
        );
      }
      if (url.pathname.startsWith('/api/')) {
        const phone = this.phoneOf(req, url);
        if (!phone) return this.json(res, 401, { error: 'not_paired' });
        if (url.pathname === '/api/frame' && req.method === 'POST') {
          if (!this.trusted(req)) return this.json(res, 403, { error: 'origin' });
          return this.json(res, 200, await this.host.answer(await this.body(req)));
        }
        if (url.pathname === '/api/events' && req.method === 'GET') {
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-store',
            connection: 'keep-alive',
          });
          res.write(': lonca\n\n');
          const stop = this.host.subscribe((frame) => res.write(`data: ${JSON.stringify(frame)}\n\n`));
          const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
          req.on('close', () => {
            clearInterval(ping);
            stop();
          });
          return;
        }
        return this.json(res, 404, { error: 'path' });
      }
      return this.file404(res, url.pathname);
    } catch {
      if (!res.headersSent) this.json(res, 400, { error: 'bad_request' });
      else res.end();
    }
  }

  /** The built UI; unknown paths get the page itself (the app routes on its own). */
  private file404(res: ServerResponse, path: string): void {
    if (!this.webDir) return void res.writeHead(404).end();
    const root = normalize(this.webDir);
    const wanted = normalize(join(root, decodeURIComponent(path)));
    let file =
      wanted.startsWith(root + sep) && existsSync(wanted) && statSync(wanted).isFile()
        ? wanted
        : join(root, 'index.html');
    if (!existsSync(file)) return void res.writeHead(404).end();
    if (!file.startsWith(root)) file = join(root, 'index.html');
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': file.endsWith('index.html') ? 'no-store' : 'max-age=3600',
      'x-content-type-options': 'nosniff',
    });
    res.end(readFileSync(file));
  }
}
