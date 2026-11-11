// Sign-in for remote connectors (PLAN.md 5.9): OAuth 2.1 as MCP servers use it. The server's 401 names its
// protected-resource metadata (RFC 9728), that names the authorization server (RFC 8414 metadata), the app registers
// itself there (RFC 7591) unless a client id was entered by hand, the person signs in in the system browser, and the
// code comes back to a one-shot listener on 127.0.0.1 (RFC 8252) with PKCE (S256) and a state value. Nothing here
// stores anything: `connectors.ts` seals the tokens.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BRAND, CoreError, connectorUrlAllowed, OAUTH_REDIRECT_PORT } from '@lonca/protocol';

/** Where a connector's sign-in happens and what its tokens are for. */
export interface OAuthServer {
  /** The resource the tokens are asked for (RFC 8707): the connector's address as its metadata names it. */
  resource: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scope?: string;
}

/** The app as the authorization server knows it. */
export interface OAuthClient {
  id: string;
  secret?: string;
  /** How the client proves itself at the token endpoint. */
  method: 'none' | 'basic' | 'post';
}

export interface OAuthTokens {
  access: string;
  refresh?: string;
  /** When the access token ends, in milliseconds since the epoch; unknown when the server does not say. */
  expires?: number;
}

const MAX_JSON = 1024 * 1024;
const b64url = (b: Buffer) => b.toString('base64url');

/** A sign-in that could not go on; `detail` is for the person, in the server's own words where it has any. */
const failed = (detail: string) => new CoreError('oauth_failed', detail.slice(0, 500));

async function request(fetcher: typeof fetch, url: string, init: RequestInit = {}): Promise<Response> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20_000);
  try {
    // Never follow a redirect: the answer must come from the address that was asked.
    return await fetcher(url, { ...init, redirect: 'error', signal: abort.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function json(res: Response): Promise<Record<string, unknown> | undefined> {
  const text = await res.text();
  if (text.length > MAX_JSON) return undefined;
  try {
    const data = JSON.parse(text);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : undefined;
  } catch {
    return undefined;
  }
}

async function getJson(fetcher: typeof fetch, url: string): Promise<Record<string, unknown> | undefined> {
  if (!connectorUrlAllowed(url)) return undefined;
  try {
    const res = await request(fetcher, url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      void res.body?.cancel().catch(() => {});
      return undefined;
    }
    return await json(res);
  } catch {
    return undefined;
  }
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

/** One parameter of a `WWW-Authenticate: Bearer` challenge. */
export function challengeParam(challenge: string | undefined, name: string): string | undefined {
  if (!challenge) return undefined;
  const m = new RegExp(`(?:^|[\\s,])${name}\\s*=\\s*(?:"([^"]*)"|([^\\s,]+))`, 'i').exec(challenge);
  return m ? (m[1] ?? m[2]) : undefined;
}

/**
 * Asks the connector's address without a token and gives its challenge: the `WWW-Authenticate` header of a 401,
 * an empty string for a 401 without one, undefined when the server does not ask for a sign-in.
 */
export async function probeChallenge(
  fetcher: typeof fetch,
  url: string,
  headers: Record<string, string>,
): Promise<string | undefined> {
  try {
    const res = await request(fetcher, url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    void res.body?.cancel().catch(() => {});
    return res.status === 401 ? (res.headers.get('www-authenticate') ?? '') : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Finds the authorization server of a connector from its address and the challenge of its 401. Every address
 * found must itself be allowed (https, or http on this computer and private networks), the resource metadata must
 * be about this connector, and the authorization server's metadata must be the named issuer's own.
 */
export async function discover(fetcher: typeof fetch, url: string, challenge?: string): Promise<OAuthServer> {
  const target = new URL(url);
  const path = trimSlash(target.pathname);
  const named = challengeParam(challenge, 'resource_metadata');
  const candidates = [
    ...(named && URL.canParse(named) && new URL(named).origin === target.origin ? [named] : []),
    ...(path ? [`${target.origin}/.well-known/oauth-protected-resource${path}`] : []),
    `${target.origin}/.well-known/oauth-protected-resource`,
  ];

  let resource = url;
  let issuer: string | undefined;
  let scopes: string | undefined;
  for (const candidate of [...new Set(candidates)]) {
    const meta = await getJson(fetcher, candidate);
    const servers = Array.isArray(meta?.authorization_servers)
      ? meta.authorization_servers.filter((s): s is string => typeof s === 'string' && connectorUrlAllowed(s))
      : [];
    const about = typeof meta?.resource === 'string' ? meta.resource : '';
    // The metadata must be about this connector: the same origin, and this address at or under the resource.
    if (!servers[0] || !URL.canParse(about) || new URL(about).origin !== target.origin) continue;
    if (!`${trimSlash(target.href)}/`.startsWith(`${trimSlash(new URL(about).href)}/`)) continue;
    resource = about;
    issuer = servers[0];
    if (Array.isArray(meta?.scopes_supported)) {
      const list = meta.scopes_supported.filter((s): s is string => typeof s === 'string' && /^[\x21-\x7e]+$/.test(s));
      if (list.length > 0) scopes = list.slice(0, 50).join(' ');
    }
    break;
  }
  // Servers from before resource metadata are their own authorization server.
  const fromResource = issuer !== undefined;
  issuer ??= target.origin;

  const iss = new URL(issuer);
  const issPath = trimSlash(iss.pathname);
  const places = [
    `${iss.origin}/.well-known/oauth-authorization-server${issPath}`,
    `${iss.origin}/.well-known/openid-configuration${issPath}`,
    ...(issPath ? [`${iss.origin}${issPath}/.well-known/openid-configuration`] : []),
  ];
  for (const place of places) {
    const meta = await getJson(fetcher, place);
    if (!meta) continue;
    const authorizationEndpoint = meta.authorization_endpoint;
    const tokenEndpoint = meta.token_endpoint;
    if (typeof authorizationEndpoint !== 'string' || typeof tokenEndpoint !== 'string') continue;
    if (typeof meta.issuer === 'string' && fromResource && trimSlash(meta.issuer) !== trimSlash(issuer))
      throw failed('the authorization server names another issuer');
    if (!connectorUrlAllowed(authorizationEndpoint) || !connectorUrlAllowed(tokenEndpoint))
      throw failed('the authorization server uses an address that is not allowed');
    const methods = meta.code_challenge_methods_supported;
    if (Array.isArray(methods) && !methods.includes('S256'))
      throw failed('the authorization server has no PKCE (S256)');
    const types = meta.response_types_supported;
    if (Array.isArray(types) && !types.includes('code')) throw failed('the authorization server gives no codes');
    const registration = meta.registration_endpoint;
    const scope = challengeParam(challenge, 'scope') ?? scopes;
    return {
      resource,
      issuer: typeof meta.issuer === 'string' ? meta.issuer : issuer,
      authorizationEndpoint,
      tokenEndpoint,
      ...(typeof registration === 'string' && connectorUrlAllowed(registration)
        ? { registrationEndpoint: registration }
        : {}),
      ...(scope ? { scope: scope.slice(0, 2000) } : {}),
    };
  }
  throw failed('the server does not say where to sign in (no authorization server metadata)');
}

/** Registers the app at the authorization server for one redirect address (RFC 7591), as a public client. */
export async function register(fetcher: typeof fetch, server: OAuthServer, redirectUri: string): Promise<OAuthClient> {
  if (!server.registrationEndpoint) throw new CoreError('oauth_unsupported');
  let res: Response;
  try {
    res = await request(fetcher, server.registrationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_name: BRAND.name,
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: 'native',
        ...(server.scope ? { scope: server.scope } : {}),
      }),
    });
  } catch (e) {
    throw failed(`registration: ${e instanceof Error ? e.message : String(e)}`);
  }
  const data = await json(res);
  if (!res.ok || typeof data?.client_id !== 'string' || !data.client_id)
    throw failed(`registration refused: ${oauthError(data) ?? `HTTP ${res.status}`}`);
  const secret = typeof data.client_secret === 'string' && data.client_secret ? data.client_secret : undefined;
  const method = data.token_endpoint_auth_method;
  return {
    id: data.client_id,
    ...(secret ? { secret } : {}),
    method: !secret || method === 'none' ? 'none' : method === 'client_secret_post' ? 'post' : 'basic',
  };
}

function oauthError(data: Record<string, unknown> | undefined): string | undefined {
  if (typeof data?.error !== 'string') return undefined;
  const text = typeof data.error_description === 'string' ? `: ${data.error_description}` : '';
  return `${data.error}${text}`;
}

/** A code verifier and its S256 challenge, and a state value: 256 random bits each. */
export function pkce(): { verifier: string; challenge: string; state: string } {
  const verifier = b64url(randomBytes(32));
  return {
    verifier,
    challenge: b64url(createHash('sha256').update(verifier).digest()),
    state: b64url(randomBytes(32)),
  };
}

/** The address the person signs in at. */
export function authorizeUrl(
  server: OAuthServer,
  client: OAuthClient,
  redirectUri: string,
  challenge: string,
  state: string,
): string {
  const url = new URL(server.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', client.id);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (server.scope) url.searchParams.set('scope', server.scope);
  url.searchParams.set('resource', server.resource);
  return url.href;
}

/** A token request that the server refused for good (a used or ended grant), as opposed to one that did not arrive. */
export class GrantRefused extends Error {}

async function token(
  fetcher: typeof fetch,
  server: OAuthServer,
  client: OAuthClient,
  params: Record<string, string>,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({ ...params, resource: server.resource });
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  if (client.method === 'basic' && client.secret)
    headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(client.id)}:${encodeURIComponent(client.secret)}`).toString('base64')}`;
  else {
    body.set('client_id', client.id);
    if (client.method === 'post' && client.secret) body.set('client_secret', client.secret);
  }
  let res: Response;
  try {
    res = await request(fetcher, server.tokenEndpoint, { method: 'POST', headers, body: body.toString() });
  } catch (e) {
    throw failed(`token: ${e instanceof Error ? e.message : String(e)}`);
  }
  const data = await json(res);
  if (!res.ok) {
    const why = oauthError(data) ?? `HTTP ${res.status}`;
    if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new GrantRefused(why);
    throw failed(`token: ${why}`);
  }
  const access = data?.access_token;
  if (typeof access !== 'string' || !access || /[\r\n]/.test(access)) throw failed('the answer holds no access token');
  if (typeof data?.token_type === 'string' && data.token_type.toLowerCase() !== 'bearer')
    throw failed(`token type ${data.token_type.slice(0, 40)} is not supported`);
  const seconds = Number(data?.expires_in);
  const refresh = data?.refresh_token;
  return {
    access,
    ...(typeof refresh === 'string' && refresh ? { refresh } : {}),
    ...(Number.isFinite(seconds) && seconds > 0 ? { expires: Date.now() + seconds * 1000 } : {}),
  };
}

/** Trades the code that came back for tokens. */
export function exchange(
  fetcher: typeof fetch,
  server: OAuthServer,
  client: OAuthClient,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<OAuthTokens> {
  return token(fetcher, server, client, {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  }).catch((e) => {
    throw e instanceof GrantRefused ? failed(`token: ${e.message}`) : e;
  });
}

/** A new access token from the refresh token; throws `GrantRefused` when the sign-in has ended. */
export function refresh(
  fetcher: typeof fetch,
  server: OAuthServer,
  client: OAuthClient,
  refreshToken: string,
): Promise<OAuthTokens> {
  return token(fetcher, server, client, { grant_type: 'refresh_token', refresh_token: refreshToken });
}

const PAGE = {
  tr: { done: 'Oturum açıldı. Bu sekme kapatılabilir.', failed: 'Oturum açılamadı. Bu sekme kapatılabilir.' },
  en: { done: 'Signed in. This tab can be closed.', failed: 'The sign-in did not finish. This tab can be closed.' },
};

function page(res: ServerResponse, status: number, text: string): void {
  const safe = text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'X-Content-Type-Options': 'nosniff',
    Connection: 'close',
  });
  res.end(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${BRAND.name}</title>` +
      `<body style="margin:0;display:grid;place-items:center;height:100vh;background:#0A0B0D;color:#E9ECF1;font:15px system-ui,sans-serif"><p>${safe}</p>`,
  );
}

/**
 * The one-shot listener the browser comes back to: `http://127.0.0.1:<port>/callback`. It takes one answer that
 * carries this sign-in's state and then closes; anything else (another path, another Host, a page's script
 * instead of a navigation, a parameter given twice, a wrong state) is refused and changes nothing.
 */
export class LoopbackCallback {
  private settle: { resolve: (code: string) => void; reject: (e: Error) => void } | undefined;
  private timer: NodeJS.Timeout | undefined;

  private constructor(
    private readonly server: Server,
    readonly port: number,
  ) {}

  get redirectUri(): string {
    return `http://127.0.0.1:${this.port}/callback`;
  }

  /** For a client id entered by hand: the fixed port its redirect address was registered with. */
  static manual(): Promise<LoopbackCallback> {
    return LoopbackCallback.listen(OAUTH_REDIRECT_PORT);
  }

  /** Listens on 127.0.0.1; `port` 0 takes any free one. Rejects when the port is taken. */
  static listen(port = 0): Promise<LoopbackCallback> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        server.on('error', () => {});
        resolve(new LoopbackCallback(server, (server.address() as AddressInfo).port));
      });
    });
  }

  /** Waits for the code of the sign-in with this state; `issuer` is checked when the answer names one (RFC 9207). */
  wait(state: string, issuer: string, language: 'tr' | 'en', timeoutMs: number): Promise<string> {
    const text = PAGE[language] ?? PAGE.en;
    const expected = Buffer.from(state);
    this.server.on('request', (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', this.redirectUri);
      const mode = req.headers['sec-fetch-mode'];
      if (
        !this.settle ||
        req.method !== 'GET' ||
        req.headers.host !== `127.0.0.1:${this.port}` ||
        url.pathname !== '/callback' ||
        (mode !== undefined && mode !== 'navigate') ||
        ['code', 'state', 'error', 'iss'].some((k) => url.searchParams.getAll(k).length > 1)
      )
        return page(res, 400, text.failed);
      const got = Buffer.from(url.searchParams.get('state') ?? '');
      if (got.length !== expected.length || !timingSafeEqual(got, expected)) return page(res, 400, text.failed);
      const { resolve, reject } = this.settle;
      const iss = url.searchParams.get('iss');
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (iss !== null && trimSlash(iss) !== trimSlash(issuer)) {
        page(res, 400, text.failed);
        reject(failed('the answer came from another authorization server'));
      } else if (error !== null || !code) {
        page(res, 400, text.failed);
        const why = url.searchParams.get('error_description');
        reject(failed(error ? `${error}${why ? `: ${why}` : ''}` : 'the answer holds no code'));
      } else {
        page(res, 200, text.done);
        resolve(code);
      }
      this.stop(false);
    });
    return new Promise<string>((resolve, reject) => {
      this.settle = { resolve, reject };
      this.timer = setTimeout(() => {
        reject(failed('no sign-in within the time allowed'));
        this.stop(true);
      }, timeoutMs);
      this.timer.unref?.();
    });
  }

  /** Stops listening; a sign-in still waited for ends as cancelled. */
  close(): void {
    this.settle?.reject(new CoreError('oauth_cancelled'));
    this.stop(true);
  }

  /** `force` drops open connections too; without it the answer just written still reaches the browser. */
  private stop(force: boolean): void {
    if (this.timer) clearTimeout(this.timer);
    this.settle = undefined;
    this.server.close();
    if (force) this.server.closeAllConnections?.();
  }
}
