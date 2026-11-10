import { describe, expect, it } from 'vitest';
import { CATALOG, catalogPlans } from '../src/catalog.js';
import { connectorUrlAllowed } from '../src/connectors.js';
import {
  connectorFromPlan,
  installPlans,
  missingFields,
  type RegistryServer,
  readRegistryServer,
} from '../src/registry.js';

// Real entries from the official MCP Registry (2026-10-22), trimmed.
const github = readRegistryServer({
  name: 'io.github.github/github-mcp-server',
  title: 'GitHub',
  version: '2.0.3',
  packages: [
    {
      registryType: 'oci',
      identifier: 'ghcr.io/github/github-mcp-server:2.0.3',
      transport: { type: 'stdio' },
      runtimeArguments: [
        {
          description: 'Optional GitHub Personal Access Token. Omit to log in with OAuth on first use.',
          value: 'GITHUB_PERSONAL_ACCESS_TOKEN={token}',
          variables: { token: { format: 'string', isSecret: true } },
          type: 'named',
          name: '-e',
        },
      ],
    },
  ],
  remotes: [
    {
      type: 'streamable-http',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: [
        {
          description: 'Authorization header with authentication token (PAT or App token)',
          isSecret: true,
          name: 'Authorization',
        },
      ],
    },
  ],
}) as RegistryServer;

const context7 = readRegistryServer({
  name: 'io.github.upstash/context7',
  version: '4.4.4',
  packages: [
    {
      registryType: 'npm',
      identifier: '@upstash/context7-mcp',
      version: '4.4.4',
      transport: { type: 'stdio' },
      environmentVariables: [{ description: 'API key for authentication', isSecret: true, name: 'CONTEXT7_API_KEY' }],
    },
    { registryType: 'mcpb', identifier: 'https://example.com/context7.mcpb', transport: { type: 'stdio' } },
  ],
  remotes: [
    {
      type: 'streamable-http',
      url: 'https://mcp.context7.com/mcp',
      headers: [{ description: 'API key for authentication.', isSecret: true, name: 'Authorization' }],
    },
    { type: 'sse', url: 'https://mcp.context7.com/sse' },
  ],
}) as RegistryServer;

const source = { from: 'catalog' as const, name: 'x', via: 'remote' as const };

describe('registry entries as connectors', () => {
  it('offers the remote first, then the packages Serai can run; SSE and MCPB are left out', () => {
    expect(installPlans(context7).map((p) => p.id)).toEqual(['remote:0', 'npm:0']);
    expect(installPlans(github).map((p) => p.id)).toEqual(['remote:0', 'oci:0']);
  });

  it('turns a remote with a key into a connector; a bare key gets Bearer, an optional one can stay out', () => {
    const [remote] = installPlans(github);
    expect(remote?.fields).toEqual([
      {
        key: 'Authorization',
        label: 'Authorization',
        secret: true,
        required: false,
        description: 'Authorization header with authentication token (PAT or App token)',
      },
    ]);
    const plan = remote as NonNullable<typeof remote>;
    expect(connectorFromPlan(plan, { Authorization: 'ghp_abc' }, { name: 'GitHub', agents: ['a1'], source })).toEqual({
      name: 'GitHub',
      kind: 'remote',
      url: 'https://api.githubcopilot.com/mcp/',
      secrets: [{ name: 'Authorization', value: 'Bearer ghp_abc' }],
      agents: ['a1'],
      source,
    });
    expect(
      connectorFromPlan(plan, { Authorization: 'token ghp_abc' }, { name: 'G', agents: [], source }).secrets,
    ).toEqual([{ name: 'Authorization', value: 'token ghp_abc' }]);
    expect(connectorFromPlan(plan, {}, { name: 'G', agents: [], source }).secrets).toEqual([]);
  });

  it('runs an npm package pinned through npx, with its variables as secrets', () => {
    const npm = installPlans(context7)[1];
    const plan = npm as NonNullable<typeof npm>;
    expect(plan.runtime).toBe('npx');
    expect(connectorFromPlan(plan, { CONTEXT7_API_KEY: 'k1' }, { name: 'Context7', agents: [], source })).toMatchObject(
      {
        kind: 'local',
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp@4.4.4'],
        secrets: [{ name: 'CONTEXT7_API_KEY', value: 'k1' }],
      },
    );
  });

  it('runs a container with docker; a variable reaches it by name only when it has a value', () => {
    const oci = installPlans(github)[1];
    const plan = oci as NonNullable<typeof oci>;
    expect(plan.runtime).toBe('docker');
    expect(connectorFromPlan(plan, { token: 'ghp_x' }, { name: 'G', agents: [], source })).toMatchObject({
      command: 'docker',
      args: ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server:2.0.3'],
      secrets: [{ name: 'GITHUB_PERSONAL_ACCESS_TOKEN', value: 'ghp_x' }],
    });
    expect(connectorFromPlan(plan, {}, { name: 'G', agents: [], source }).args).toEqual([
      'run',
      '-i',
      '--rm',
      'ghcr.io/github/github-mcp-server:2.0.3',
    ]);
  });

  it('asks for required arguments and fills them in place', () => {
    const fs = readRegistryServer({
      name: 'io.example/files',
      packages: [
        {
          registryType: 'pypi',
          identifier: 'files-mcp',
          version: '1.0.0',
          packageArguments: [
            { type: 'positional', valueHint: 'directory', isRequired: true, description: 'Folder to serve' },
            { type: 'named', name: '--read-only' },
            { type: 'named', name: '--depth', value: '{depth}', variables: { depth: { default: '2' } } },
          ],
        },
      ],
    }) as RegistryServer;
    const [plan] = installPlans(fs);
    const p = plan as NonNullable<typeof plan>;
    expect(p.fields.map((f) => [f.key, f.required, f.default])).toEqual([
      ['directory', true, undefined],
      ['depth', false, '2'],
    ]);
    expect(missingFields(p, {})).toEqual(['directory']);
    expect(connectorFromPlan(p, { directory: 'C:\\Proje' }, { name: 'F', agents: [], source }).args).toEqual([
      'files-mcp@1.0.0',
      'C:\\Proje',
      '--read-only',
      '--depth',
      '2',
    ]);
  });

  it('keeps a registry answer to its expected shape', () => {
    expect(readRegistryServer({ name: '' })).toBeUndefined();
    expect(readRegistryServer('x')).toBeUndefined();
    const odd = readRegistryServer({
      name: 'io.example/odd',
      description: 'x'.repeat(5000),
      remotes: [{ type: 'streamable-http', url: 42 }, 'nope'],
      packages: [{ registryType: 'npm' }],
      extra: { anything: true },
    });
    expect(odd?.description?.length).toBe(1000);
    expect(odd?.remotes).toEqual([]);
    expect(odd?.packages).toEqual([]);
    expect(odd).not.toHaveProperty('extra');
  });
});

describe('the catalog', () => {
  it('offers only plans its entries have, with addresses Serai accepts and defaults for real fields', () => {
    expect(new Set(CATALOG.map((e) => e.id)).size).toBe(CATALOG.length);
    for (const entry of CATALOG) {
      const plans = installPlans(entry.server);
      expect(entry.plans.length, entry.id).toBeGreaterThan(0);
      for (const id of entry.plans) {
        const plan = plans.find((p) => p.id === id);
        expect(plan, `${entry.id} ${id}`).toBeDefined();
        if (plan?.url) expect(connectorUrlAllowed(plan.url), entry.id).toBe(true);
      }
      for (const key of Object.keys(entry.defaults ?? {})) {
        expect(
          entry.plans.some((id) => plans.find((p) => p.id === id)?.fields.some((f) => f.key === key)),
          `${entry.id} ${key}`,
        ).toBe(true);
      }
      expect(entry.summary.tr && entry.summary.en, entry.id).toBeTruthy();
    }
  });

  it('asks for what a server needs even where its entry says optional', () => {
    const github = CATALOG.find((e) => e.id === 'github') as (typeof CATALOG)[number];
    const [remote, docker] = catalogPlans(github);
    expect(remote?.fields.find((f) => f.key === 'Authorization')?.required).toBe(true);
    expect(missingFields(remote as NonNullable<typeof remote>, {})).toEqual(['Authorization']);
    expect(docker?.fields.find((f) => f.key === 'token')?.required).toBe(true);
  });

  it('starts Supabase read-only and keeps its token out of the arguments', () => {
    const entry = CATALOG.find((e) => e.id === 'supabase');
    const plan = installPlans(entry?.server as RegistryServer).find((p) => p.id === 'npm:0');
    const input = connectorFromPlan(
      plan as NonNullable<typeof plan>,
      { ...entry?.defaults, SUPABASE_ACCESS_TOKEN: 'sbp_1' },
      { name: 'Supabase', agents: [], source },
    );
    expect(input.args).toContain('--read-only');
    expect(input.args?.join(' ')).not.toContain('sbp_1');
    expect(input.secrets).toEqual([{ name: 'SUPABASE_ACCESS_TOKEN', value: 'sbp_1' }]);
  });
});
