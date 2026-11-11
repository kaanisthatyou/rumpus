// A stand-in for a remote MCP server that signs in with OAuth, and for its authorization server, in one process:
// a 401 that names the resource metadata, the metadata of both, client registration, an authorize address that
// answers at once like a person who agreed (or refused), a token endpoint that checks PKCE and rotates refresh
// tokens, and an MCP endpoint that takes only tokens it gave out. For unit tests and e2e/channel.mjs.
import { createHash, randomBytes } from 'node:crypto';
import { createServer, request } from 'node:http';

/**
 * @param {{ registration?: boolean, expiresIn?: number, pkce?: boolean, issuer?: string, deny?: boolean,
 *   resourceMetadata?: boolean }} [options]
 */
export async function startFakeOAuthMcp(options = {}) {
  const opts = { registration: true, expiresIn: 3600, pkce: true, deny: false, resourceMetadata: true, ...options };
  const clients = new Map(); // client id → redirect uris
  const codes = new Map(); // code → { client, redirect, challenge }
  const access = new Set();
  const refresh = new Set();
  const log = { registrations: 0, tokens: [], calls: [] };
  let n = 0;
  let origin = '';

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const read = async (req) => {
    let raw = '';
    for await (const c of req) raw += c;
    return raw;
  };
  const grant = () => {
    n += 1;
    const a = `at-${n}-${randomBytes(4).toString('hex')}`;
    const r = `rt-${n}-${randomBytes(4).toString('hex')}`;
    access.add(a);
    refresh.add(r);
    return { access_token: a, refresh_token: r, token_type: 'Bearer', expires_in: opts.expiresIn };
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', origin);
    if (url.pathname === '/.well-known/oauth-protected-resource/mcp' && opts.resourceMetadata)
      return send(res, 200, {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: ['notes'],
      });
    if (url.pathname === '/.well-known/oauth-authorization-server')
      return send(res, 200, {
        issuer: opts.issuer ?? origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        ...(opts.registration ? { registration_endpoint: `${origin}/register` } : {}),
        response_types_supported: ['code'],
        code_challenge_methods_supported: opts.pkce ? ['S256'] : ['plain'],
        authorization_response_iss_parameter_supported: true,
      });
    if (url.pathname === '/register' && req.method === 'POST' && opts.registration) {
      const body = JSON.parse(await read(req));
      if (!Array.isArray(body.redirect_uris) || body.token_endpoint_auth_method !== 'none')
        return send(res, 400, { error: 'invalid_client_metadata' });
      const id = `client-${clients.size + 1}`;
      clients.set(id, body.redirect_uris);
      log.registrations += 1;
      return send(res, 201, { client_id: id, redirect_uris: body.redirect_uris, token_endpoint_auth_method: 'none' });
    }
    if (url.pathname === '/authorize') {
      const q = url.searchParams;
      const redirect = q.get('redirect_uri') ?? '';
      const uris = clients.get(q.get('client_id') ?? '');
      const ok =
        uris?.includes(redirect) &&
        q.get('response_type') === 'code' &&
        q.get('code_challenge_method') === 'S256' &&
        q.get('code_challenge') &&
        q.get('state') &&
        q.get('resource') === `${origin}/mcp`;
      if (!ok) return send(res, 400, { error: 'invalid_request' });
      const back = new URL(redirect);
      back.searchParams.set('state', q.get('state'));
      back.searchParams.set('iss', opts.issuer ?? origin);
      if (opts.deny) {
        back.searchParams.set('error', 'access_denied');
        back.searchParams.set('error_description', 'The person refused.');
      } else {
        const code = `code-${randomBytes(6).toString('hex')}`;
        codes.set(code, { client: q.get('client_id'), redirect, challenge: q.get('code_challenge') });
        back.searchParams.set('code', code);
      }
      res.writeHead(302, { location: back.href });
      return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const form = new URLSearchParams(await read(req));
      log.tokens.push(form.get('grant_type'));
      if (form.get('resource') !== `${origin}/mcp`) return send(res, 400, { error: 'invalid_target' });
      if (form.get('grant_type') === 'authorization_code') {
        const code = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        const proof = createHash('sha256')
          .update(form.get('code_verifier') ?? '')
          .digest('base64url');
        if (
          !code ||
          code.client !== form.get('client_id') ||
          code.redirect !== form.get('redirect_uri') ||
          code.challenge !== proof
        )
          return send(res, 400, { error: 'invalid_grant', error_description: 'The code is not good.' });
        return send(res, 200, grant());
      }
      if (form.get('grant_type') === 'refresh_token') {
        const old = form.get('refresh_token') ?? '';
        if (!refresh.has(old) || !clients.has(form.get('client_id') ?? ''))
          return send(res, 400, { error: 'invalid_grant', error_description: 'The sign-in has ended.' });
        refresh.delete(old);
        return send(res, 200, grant());
      }
      return send(res, 400, { error: 'unsupported_grant_type' });
    }
    if (url.pathname === '/mcp' && req.method === 'POST') {
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      if (!access.has(token))
        return send(
          res,
          401,
          { error: 'invalid_token' },
          {
            'www-authenticate': `Bearer realm="OAuth", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="notes"`,
          },
        );
      const m = JSON.parse(await read(req));
      if (m.id === undefined) return send(res, 202);
      log.calls.push({ method: m.method, token });
      const result =
        m.method === 'initialize'
          ? {
              protocolVersion: '2025-06-18',
              capabilities: {},
              serverInfo: { name: 'fake-oauth-notes', version: '1.0.0' },
            }
          : m.method === 'tools/list'
            ? {
                tools: [
                  {
                    name: 'whoami',
                    description: 'Says which sign-in the call came with.',
                    inputSchema: { type: 'object' },
                    annotations: { readOnlyHint: true },
                  },
                ],
              }
            : { content: [{ type: 'text', text: `signed in with ${token.split('-').slice(0, 2).join('-')}` }] };
      return send(res, 200, { jsonrpc: '2.0', id: m.id, result });
    }
    if (url.pathname === '/mcp' && req.method === 'DELETE') return send(res, 200);
    send(res, 404, { error: 'not_found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r()));
  origin = `http://127.0.0.1:${server.address().port}`;

  return {
    origin,
    url: `${origin}/mcp`,
    log,
    options: opts,
    /** A client made at the service by hand, for a redirect address. */
    addClient(id, redirectUri) {
      clients.set(id, [redirectUri]);
    },
    /** Every access token ends now; refresh tokens stay. */
    expireAccess() {
      access.clear();
    },
    /** The sign-in ends: no token of any kind is good any more. */
    endGrants() {
      access.clear();
      refresh.clear();
    },
    close() {
      server.close();
      server.closeAllConnections?.();
    },
  };
}

/**
 * A browser's navigation to an address on this computer, with the headers given on top (Node's own `fetch` always
 * says it is a page's script, and takes no other Host). Gives the status of the answer.
 */
export function visit(url, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers: { 'sec-fetch-mode': 'navigate', ...headers } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * What the browser does with a sign-in address: asks it, and follows the redirect back to the app's listener.
 * Gives the status of the listener's answer.
 */
export async function browse(url) {
  const first = await fetch(url, { redirect: 'manual' });
  const back = first.headers.get('location');
  if (!back) throw new Error(`the sign-in address answered ${first.status}`);
  return { status: await visit(back), back };
}
