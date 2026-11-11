// Opt-in: Rumpus's MCP client against the catalog's remote servers that need no key (they are free and public;
// nothing is called but initialize and tools/list). LONCA_REAL_REMOTE=1.
import { CATALOG, catalogPlans, connectorFromPlan } from '@lonca/protocol';
import { describe, expect, it } from 'vitest';
import { connectorEnv, McpClient } from '../src/mcp.js';
import { discover, probeChallenge } from '../src/oauth.js';

// The entries that sign in through the browser: only what anyone may read is asked (the 401 and the metadata it
// points at); nothing is registered and nobody signs in.
const signIn = CATALOG.filter((entry) => entry.signIn).flatMap((entry) =>
  catalogPlans(entry).map((p) => ({ id: `${entry.id} ${p.id}`, url: p.url ?? '' })),
);

describe.skipIf(!process.env.LONCA_REAL_REMOTE)('real remote connectors that sign in', () => {
  it.each(signIn)(
    '$id asks for a sign-in, names its authorization server, and registers apps itself',
    async ({ url }) => {
      const challenge = await probeChallenge(fetch, url, {});
      expect(challenge).toMatch(/^Bearer/i);
      const server = await discover(fetch, url, challenge);
      console.log(url, server);
      expect(server.registrationEndpoint).toBeDefined();
      expect(new URL(server.resource).origin).toBe(new URL(url).origin);
    },
    60_000,
  );
});

const keyless = CATALOG.filter((entry) => !entry.signIn)
  .flatMap((entry) =>
    catalogPlans(entry)
      .filter((p) => p.via === 'remote' && p.fields.every((f) => !f.required))
      .map((p) => ({ id: entry.id, url: p.url ?? '' })),
  )
  .filter((e) => !e.url.includes('{'));

describe.skipIf(!process.env.LONCA_REAL_REMOTE)('real remote connectors', () => {
  it.each(keyless)(
    '$id answers initialize and lists its tools',
    async ({ url }) => {
      const client = await McpClient.connect({ kind: 'remote', url, headers: {} }, 30_000);
      try {
        const tools = await client.tools();
        console.log(
          url,
          client.server,
          tools.length,
          tools.slice(0, 5).map((t) => t.name),
        );
        expect(tools.length).toBeGreaterThan(0);
      } finally {
        client.close();
      }
    },
    60_000,
  );
});

// Opt-in: the catalog's npm entries that need no key, started through npx the way Rumpus starts them (the first
// run downloads the pinned package). LONCA_REAL_NPX=1.
const npxKeyless = CATALOG.flatMap((entry) =>
  catalogPlans(entry)
    .filter((p) => p.via === 'npm' && p.fields.every((f) => !f.required))
    .map((p) => ({
      id: entry.id,
      input: connectorFromPlan(p, {}, { name: entry.name, agents: [], source: undefined }),
    })),
);

describe.skipIf(!process.env.LONCA_REAL_NPX)('real npx connectors', () => {
  it.each(npxKeyless)(
    '$id starts and lists its tools',
    async ({ input }) => {
      const client = await McpClient.connect(
        { kind: 'local', command: input.command ?? '', args: input.args ?? [], env: connectorEnv(process.env, {}) },
        180_000,
      );
      try {
        const tools = await client.tools();
        console.log(input.args?.join(' '), client.server, tools.length);
        expect(tools.length).toBeGreaterThan(0);
      } finally {
        client.close();
      }
    },
    240_000,
  );
});
