// Opt-in: Lonca's MCP client against the catalog's remote servers that need no key (they are free and public;
// nothing is called but initialize and tools/list). LONCA_REAL_REMOTE=1.
import { CATALOG, catalogPlans, connectorFromPlan } from '@lonca/protocol';
import { describe, expect, it } from 'vitest';
import { connectorEnv, McpClient } from '../src/mcp.js';

const keyless = CATALOG.flatMap((entry) =>
  catalogPlans(entry)
    .filter((p) => p.via === 'remote' && p.fields.every((f) => !f.required))
    .map((p) => ({ id: entry.id, url: p.url ?? '' })),
).filter((e) => !e.url.includes('{'));

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

// Opt-in: the catalog's npm entries that need no key, started through npx the way Lonca starts them (the first
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
