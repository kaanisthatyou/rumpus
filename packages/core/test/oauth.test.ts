import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ConnectorInfo, OAUTH_REDIRECT_URI } from '@lonca/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { Connectors, type Sealer } from '../src/connectors.js';
import { challengeParam, discover } from '../src/oauth.js';
import { browse, type FakeOAuthMcp, startFakeOAuthMcp, visit } from './fixtures/fake-oauth-mcp.mjs';

/** Seals by reversing and marking: enough to see that the file never holds the value. */
const sealer: Sealer = {
  protection: () => 'os',
  seal: async (p) => `sealed:${Buffer.from(p).toString('base64').split('').reverse().join('')}`,
  open: async (s) => Buffer.from(s.slice(7).split('').reverse().join(''), 'base64').toString(),
};

const closers: (() => void)[] = [];
afterEach(() => {
  for (const c of closers.splice(0)) c();
});

async function setup(options?: Parameters<typeof startFakeOAuthMcp>[0]) {
  const server = await startFakeOAuthMcp(options);
  const file = join(mkdtempSync(join(tmpdir(), 'lonca-oauth-')), 'connectors.json');
  const connectors = new Connectors(file, sealer);
  closers.push(() => {
    connectors.close();
    server.close();
  });
  const only = () => connectors.state().connectors[0] as ConnectorInfo;
  const until = async (fn: () => boolean, what: string) => {
    for (let i = 0; i < 500; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timed out: ${what} (${JSON.stringify(only())})`);
  };
  const settled = () => until(() => only().state !== 'testing' && only().state !== 'untested', 'the test');
  /** Adds the connector and waits for the test that finds the server asking for a sign-in. */
  const add = async (extra: { clientId?: string } = {}) => {
    await connectors.save({ name: 'Notlar', kind: 'remote', url: server.url, agents: ['agent-1'], ...extra });
    await settled();
    return only().id;
  };
  /** A whole sign-in, with the stand-in as the person who agrees. */
  const signIn = async (id: string) => {
    const { url } = await connectors.signIn(id, 'en');
    await browse(url);
    await until(() => only().oauth?.state === 'signed_in' && only().state === 'ok', 'the sign-in');
  };
  return { server, file, connectors, only, until, add, signIn };
}

describe('a connector that signs in with OAuth', () => {
  it('finds where to sign in, registers itself, takes the code with PKCE and keeps the tokens sealed', async () => {
    const { server, file, connectors, only, add, until } = await setup();
    const id = await add();
    expect(only()).toMatchObject({ state: 'failed', error: 'connector_auth', oauth: { state: 'needed' } });
    expect(only().detail).toBeUndefined();

    const { url, state } = await connectors.signIn(id, 'en');
    expect(state.connectors[0]?.oauth?.state).toBe('waiting');
    const asked = new URL(url);
    expect(asked.origin + asked.pathname).toBe(`${server.origin}/authorize`);
    expect(Object.fromEntries(asked.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'client-1',
      code_challenge_method: 'S256',
      scope: 'notes',
      resource: server.url,
    });
    expect(asked.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(asked.searchParams.get('state')?.length).toBeGreaterThanOrEqual(43);

    expect((await browse(url)).status).toBe(200);
    await until(() => only().oauth?.state === 'signed_in' && only().state === 'ok', 'the sign-in');
    expect(only()).toMatchObject({
      server: { name: 'fake-oauth-notes' },
      oauth: { state: 'signed_in', issuer: server.origin },
      tools: [{ name: 'whoami', readOnly: true, policy: 'allow' }],
    });
    // The page gets where the sign-in stands and nothing of the tokens.
    expect(Object.keys(only().oauth ?? {}).sort()).toEqual(['issuer', 'state']);
    const kept = readFileSync(file, 'utf8');
    expect(kept).not.toMatch(/"(at|rt)-\d/);
    expect(kept).toContain('sealed:');

    const answer = await connectors.call(id, 'whoami', {});
    expect(JSON.stringify(answer)).toContain('signed in with at-1');
    expect(connectors.forAgent('agent-1').map((t) => t.exposed)).toEqual(['notlar__whoami']);
    // The listener is gone once it has taken its one answer.
    await expect(visit(asked.searchParams.get('redirect_uri') ?? '')).rejects.toThrow();
  });

  it('renews a token the server refuses or that is about to end, and keeps the rotated refresh token', async () => {
    const { server, connectors, add, signIn } = await setup();
    const id = await add();
    await signIn(id);
    server.expireAccess();
    expect(JSON.stringify(await connectors.call(id, 'whoami', {}))).toContain('signed in with at-2');
    server.expireAccess();
    expect(JSON.stringify(await connectors.call(id, 'whoami', {}))).toContain('signed in with at-3');
    expect(server.log.tokens).toEqual(['authorization_code', 'refresh_token', 'refresh_token']);

    // A token with under a minute left is renewed before it is sent, once for requests at the same moment.
    const short = await setup({ expiresIn: 30 });
    const sid = await short.add();
    await short.signIn(sid);
    const before = short.server.log.tokens.length;
    await Promise.all([short.connectors.call(sid, 'whoami', {}), short.connectors.call(sid, 'whoami', {})]);
    expect(short.server.log.tokens.length).toBe(before + 1);
  });

  it('shows a sign-in that ended, takes the tools from the agents, and signs in again with the same client', async () => {
    const { server, connectors, only, add, signIn } = await setup();
    const id = await add();
    await signIn(id);
    server.endGrants();
    await expect(connectors.call(id, 'whoami', {})).rejects.toThrow(/sign-in has ended/);
    expect(only()).toMatchObject({ state: 'failed', error: 'connector_auth', oauth: { state: 'needed' } });
    expect(connectors.forAgent('agent-1')).toEqual([]);

    await signIn(id);
    expect(server.log.registrations).toBe(1);
    expect(connectors.forAgent('agent-1')).toHaveLength(1);

    // Signing out forgets the tokens here.
    connectors.signOut(id);
    expect(only()).toMatchObject({ state: 'failed', error: 'connector_auth', oauth: { state: 'needed' } });
    await expect(connectors.call(id, 'whoami', {})).rejects.toThrow(/401/);
  });

  it('refuses answers that are not this sign-in’s and keeps waiting', async () => {
    const { server, connectors, only, add, until } = await setup();
    const id = await add();
    const { url } = await connectors.signIn(id, 'en');
    const asked = new URL(url);
    const back = asked.searchParams.get('redirect_uri') ?? '';
    const state = asked.searchParams.get('state') ?? '';
    const port = new URL(back).port;

    expect(await visit(`${back}?code=x&state=wrong`)).toBe(400);
    expect(await visit(`${back}?code=x&code=y&state=${state}`)).toBe(400);
    expect(await visit(`${back.replace('/callback', '/other')}?code=x&state=${state}`)).toBe(400);
    expect(await visit(`${back}?code=x&state=${state}`, {}, 'POST')).toBe(400);
    // A page's script instead of a navigation, and a name that only points at this computer.
    expect(await visit(`${back}?code=x&state=${state}`, { 'sec-fetch-mode': 'cors' })).toBe(400);
    expect(await visit(`${back}?code=x&state=${state}`, { host: `evil.example:${port}` })).toBe(400);
    expect(only().oauth?.state).toBe('waiting');

    // An answer that names another authorization server ends it.
    expect(await visit(`${back}?code=x&state=${state}&iss=https://evil.example`)).toBe(400);
    await until(() => only().oauth?.state === 'needed', 'the refusal');
    expect(only().oauth).toMatchObject({
      error: 'oauth_failed',
      detail: expect.stringMatching(/another authorization/),
    });

    // The person refuses: the server's own words are kept.
    server.options.deny = true;
    const again = await connectors.signIn(id, 'en');
    expect((await browse(again.url)).status).toBe(400);
    await until(() => only().oauth?.error === 'oauth_failed', 'the refusal');
    expect(only().oauth?.detail).toBe('access_denied: The person refused.');

    // Cancelling leaves no error and closes the listener.
    server.options.deny = false;
    const third = await connectors.signIn(id, 'en');
    expect(only().oauth).toEqual({ state: 'waiting' });
    expect(connectors.cancelSignIn(id).connectors[0]?.oauth).toEqual({ state: 'needed' });
    await expect(visit(new URL(third.url).searchParams.get('redirect_uri') ?? '')).rejects.toThrow();
    // None of this reached the token endpoint.
    expect(server.log.tokens).toEqual([]);
  });

  it('uses a client id entered by hand where the server registers no apps', async () => {
    const { server, connectors, only, add, signIn } = await setup({ registration: false });
    const id = await add();
    await expect(connectors.signIn(id, 'en')).rejects.toMatchObject({ code: 'oauth_unsupported' });

    server.addClient('by-hand', OAUTH_REDIRECT_URI);
    await connectors.save({ id, name: 'Notlar', kind: 'remote', url: server.url, clientId: 'by-hand' });
    expect(only().oauth).toMatchObject({ state: 'needed', clientId: 'by-hand' });
    await signIn(id);
    expect(only().oauth).toMatchObject({ state: 'signed_in', clientId: 'by-hand' });
    server.expireAccess();
    expect(JSON.stringify(await connectors.call(id, 'whoami', {}))).toContain('signed in with at-2');

    // Another client id: the tokens were the former client's.
    await connectors.save({ id, name: 'Notlar', kind: 'remote', url: server.url, clientId: 'other' });
    expect(only().oauth).toEqual({ state: 'needed', clientId: 'other' });
    await expect(
      connectors.save({ id, name: 'Notlar', kind: 'remote', url: server.url, clientId: 'has space' }),
    ).rejects.toMatchObject({ code: 'invalid_connector' });
  });

  it('drops the sign-in when the address changes, and leaves a wrong key of the person’s own as it is', async () => {
    const { server, connectors, only, add, signIn, until } = await setup();
    const id = await add();
    await signIn(id);
    await connectors.save({ id, name: 'Notlar', kind: 'remote', url: `${server.origin}/mcp?x=1` });
    expect(only().oauth).toBeUndefined();

    // With an Authorization header of the person's own, a 401 is a wrong key, not a sign-in.
    await connectors.save({
      id,
      name: 'Notlar',
      kind: 'remote',
      url: server.url,
      secrets: [{ name: 'Authorization', value: 'Bearer wrong-key' }],
    });
    await until(() => only().state === 'failed', 'the test');
    expect(only()).toMatchObject({ error: 'connector_failed', detail: expect.stringMatching(/^HTTP 401/) });
    expect(only().oauth).toBeUndefined();
  });
});

describe('finding the authorization server', () => {
  const start = async (options?: Parameters<typeof startFakeOAuthMcp>[0]): Promise<FakeOAuthMcp> => {
    const server = await startFakeOAuthMcp(options);
    closers.push(() => server.close());
    return server;
  };

  it('reads a challenge’s parameters', () => {
    const c = 'Bearer realm="OAuth", resource_metadata="https://x.example/.well-known/a", scope="read write"';
    expect(challengeParam(c, 'resource_metadata')).toBe('https://x.example/.well-known/a');
    expect(challengeParam(c, 'scope')).toBe('read write');
    expect(challengeParam('Bearer error=invalid_token,scope=notes', 'scope')).toBe('notes');
    expect(challengeParam(c, 'metadata')).toBeUndefined();
    expect(challengeParam(undefined, 'scope')).toBeUndefined();
  });

  it('goes by the well-known places without a challenge, and by the server itself without resource metadata', async () => {
    const server = await start();
    expect(await discover(fetch, server.url)).toEqual({
      resource: server.url,
      issuer: server.origin,
      authorizationEndpoint: `${server.origin}/authorize`,
      tokenEndpoint: `${server.origin}/token`,
      registrationEndpoint: `${server.origin}/register`,
      scope: 'notes',
    });
    const old = await start({ resourceMetadata: false });
    expect(await discover(fetch, old.url)).toMatchObject({ resource: old.url, issuer: old.origin });
  });

  it('refuses an authorization server that names another issuer or has no S256', async () => {
    const other = await start({ issuer: 'https://elsewhere.example' });
    await expect(discover(fetch, other.url)).rejects.toMatchObject({ code: 'oauth_failed' });
    const plain = await start({ pkce: false });
    await expect(discover(fetch, plain.url)).rejects.toThrow(/PKCE/);
  });

  it('does not take resource metadata from another site, or metadata about another site', async () => {
    const server = await start();
    const asked: string[] = [];
    const spy: typeof fetch = (input, init) => {
      asked.push(String(input));
      return fetch(input, init);
    };
    await discover(spy, server.url, 'Bearer resource_metadata="https://evil.example/.well-known/x"');
    expect(asked.some((u) => u.includes('evil.example'))).toBe(false);

    const lying: typeof fetch = async (input, init) => {
      if (String(input).includes('oauth-protected-resource'))
        return Response.json({ resource: 'https://evil.example/mcp', authorization_servers: ['https://evil.example'] });
      return fetch(input, init);
    };
    expect(await discover(lying, server.url)).toMatchObject({ issuer: server.origin, resource: server.url });
  });
});
