// Serai's catalog of connectors (PLAN.md 5.9): entries of the official MCP Registry that Serai checked, copied as
// they were on the day they were checked, with the ways to install them that work, and corrections where a server
// needs more than its entry says. Everything here installs through the same steps as a registry search result
// (`registry.ts`). Checked: 2026-10-22; the entries that sign in through the browser (`signIn`): 2026-11-11.
import { type InstallPlan, installPlans, type RegistryServer } from './registry.js';

export const CATALOG_CATEGORIES = ['code', 'docs', 'browser', 'search', 'data', 'ops'] as const;
export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

export interface CatalogEntry {
  id: string;
  name: string;
  category: CatalogCategory;
  summary: { tr: string; en: string };
  /** The install plans offered (`remote:0`, `npm:0`, ...), in order; the entry's others are left out. */
  plans: string[];
  /** Where a key or token for it is made. */
  keyUrl?: string;
  /** Values filled in before the person changes them: safe defaults, such as read-only. */
  defaults?: Record<string, string>;
  /** Fields the registry calls optional that the server needs after all (checked against the server). */
  required?: string[];
  /**
   * The server takes no key: after installing, a sign-in in the browser is asked for (OAuth, with the app
   * registering itself at the service; checked against the server's metadata).
   */
  signIn?: true;
  server: RegistryServer;
}

/** The plans Serai offers for a catalog entry, with its corrections applied. */
export function catalogPlans(entry: CatalogEntry): InstallPlan[] {
  const all = installPlans(entry.server);
  return entry.plans
    .map((id) => all.find((p) => p.id === id))
    .filter((p): p is InstallPlan => p !== undefined)
    .map((p) => ({
      ...p,
      fields: p.fields.map((f) => (entry.required?.includes(f.key) ? { ...f, required: true } : f)),
      headers: p.headers.map((h) => (entry.required?.includes(h.name) ? { ...h, optional: false } : h)),
    }));
}

export const CATALOG: CatalogEntry[] = [
  {
    id: 'github',
    name: 'GitHub',
    category: 'code',
    summary: {
      tr: "Depolar, issue'lar, pull request'ler ve iş akışları. Kişisel erişim token'ı ister.",
      en: 'Repositories, issues, pull requests and workflows. Needs a personal access token.',
    },
    plans: ['remote:0', 'oci:0'],
    keyUrl: 'https://github.com/settings/personal-access-tokens',
    required: ['Authorization', 'token'],
    server: {
      name: 'io.github.github/github-mcp-server',
      title: 'GitHub',
      description:
        'Connect AI assistants to GitHub - manage repos, issues, PRs, and workflows through natural language.',
      version: '2.0.3',
      repository: {
        url: 'https://github.com/github/github-mcp-server',
      },
      remotes: [
        {
          type: 'streamable-http',
          url: 'https://api.githubcopilot.com/mcp/',
          headers: [
            {
              name: 'Authorization',
              description: 'Authorization header with authentication token (PAT or App token)',
              isSecret: true,
            },
          ],
        },
      ],
      packages: [
        {
          registryType: 'oci',
          identifier: 'ghcr.io/github/github-mcp-server:2.0.3',
          transport: {
            type: 'stdio',
          },
          runtimeArguments: [
            {
              name: '-p',
              description:
                'Publish the OAuth callback port to loopback so the in-container login callback is reachable',
              value: '127.0.0.1:8085:8085',
              type: 'named',
            },
            {
              name: '-e',
              description: 'Fixed OAuth callback port, matching the published port above',
              value: 'GITHUB_OAUTH_CALLBACK_PORT=8085',
              type: 'named',
            },
            {
              name: '-e',
              description: 'Optional GitHub Personal Access Token. Omit to log in with OAuth on first use.',
              value: 'GITHUB_PERSONAL_ACCESS_TOKEN={token}',
              variables: {
                token: {
                  isSecret: true,
                  format: 'string',
                },
              },
              type: 'named',
            },
          ],
        },
      ],
    },
  },
  {
    id: 'context7',
    name: 'Context7',
    category: 'docs',
    summary: {
      tr: 'Kütüphanelerin güncel, sürüme özel belgeleri ve kod örnekleri. Anahtar isteğe bağlı.',
      en: 'Up-to-date, version-specific library docs and code samples. Key optional.',
    },
    plans: ['remote:0', 'npm:0'],
    keyUrl: 'https://context7.com/dashboard',
    server: {
      name: 'io.github.upstash/context7',
      title: 'Context7',
      description: 'Up-to-date docs for AI agents',
      version: '4.4.4',
      websiteUrl: 'https://context7.com',
      repository: {
        url: 'https://github.com/upstash/context7',
      },
      remotes: [
        {
          type: 'streamable-http',
          url: 'https://mcp.context7.com/mcp',
          headers: [
            {
              name: 'Authorization',
              description: 'API key for authentication. Accepts "Bearer <key>" or the raw key.',
              isSecret: true,
            },
          ],
        },
      ],
      packages: [
        {
          registryType: 'npm',
          identifier: '@upstash/context7-mcp',
          version: '4.4.4',
          transport: {
            type: 'stdio',
          },
          environmentVariables: [
            {
              name: 'CONTEXT7_API_KEY',
              description: 'API key for authentication',
              isSecret: true,
            },
          ],
        },
        {
          registryType: 'mcpb',
          identifier: 'https://github.com/upstash/context7/releases/download/mcpb-v4.4.4/context7.mcpb',
          version: '4.4.4',
          transport: {
            type: 'stdio',
          },
          environmentVariables: [
            {
              name: 'CONTEXT7_API_KEY',
              description: 'API key for authentication',
              isSecret: true,
            },
          ],
        },
      ],
    },
  },
  {
    id: 'microsoft-learn',
    name: 'Microsoft Learn',
    category: 'docs',
    summary: {
      tr: 'Microsoft Learn belgeleri ve kod örnekleri. Anahtarsız.',
      en: 'Microsoft Learn docs and code samples. No key.',
    },
    plans: ['remote:0'],
    server: {
      name: 'com.microsoft/microsoft-learn-mcp',
      title: 'Microsoft Learn MCP',
      description: 'Official Microsoft Learn MCP Server – real-time, trusted docs & code samples for AI and LLMs.',
      version: '1.0.0',
      websiteUrl: 'https://github.com/MicrosoftDocs/mcp',
      repository: {
        url: 'https://github.com/MicrosoftDocs/mcp',
      },
      remotes: [
        {
          type: 'streamable-http',
          url: 'https://learn.microsoft.com/api/mcp',
        },
      ],
    },
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'docs',
    summary: {
      tr: 'Notion sayfaları ve veritabanları: arama, okuma, yazma. Anahtar yok; tarayıcıda oturum açılır.',
      en: 'Notion pages and databases: search, read, write. No key; signs in through the browser.',
    },
    plans: ['remote:0'],
    signIn: true,
    server: {
      name: 'com.notion/mcp',
      description: 'Official Notion MCP server',
      version: '1.0.1',
      remotes: [
        {
          type: 'streamable-http',
          url: 'https://mcp.notion.com/mcp',
        },
        {
          type: 'sse',
          url: 'https://mcp.notion.com/sse',
        },
      ],
    },
  },
  {
    id: 'linear',
    name: 'Linear',
    category: 'code',
    summary: {
      tr: "Linear issue'ları, projeleri ve belgeleri. Anahtar yok; tarayıcıda oturum açılır.",
      en: 'Linear issues, projects and documents. No key; signs in through the browser.',
    },
    plans: ['remote:0', 'remote:1'],
    signIn: true,
    server: {
      name: 'app.linear/linear',
      title: 'Linear',
      description: 'Find and manage issues, projects, and documents in your Linear workspace.',
      version: '1.0.2',
      websiteUrl: 'https://linear.app',
      remotes: [
        {
          type: 'streamable-http',
          url: 'https://mcp.linear.app/mcp',
        },
        {
          type: 'streamable-http',
          url: 'https://mcp.linear.app/mcp/readonly',
        },
      ],
    },
  },
  {
    id: 'playwright',
    name: 'Playwright',
    category: 'browser',
    summary: {
      tr: 'Gerçek bir tarayıcıyı sürer: sayfa açar, tıklar, form doldurur, ekran görüntüsü alır.',
      en: 'Drives a real browser: opens pages, clicks, fills forms, takes screenshots.',
    },
    plans: ['npm:0'],
    server: {
      name: 'io.github.microsoft/playwright-mcp',
      description: 'Playwright Tools for MCP',
      version: '0.0.82',
      repository: {
        url: 'https://github.com/microsoft/playwright-mcp',
      },
      packages: [
        {
          registryType: 'npm',
          identifier: '@playwright/mcp',
          version: '0.0.82',
          transport: {
            type: 'stdio',
          },
        },
      ],
    },
  },
  {
    id: 'chrome-devtools',
    name: 'Chrome DevTools',
    category: 'browser',
    summary: {
      tr: 'Chrome DevTools: konsol, ağ istekleri, performans izleri.',
      en: 'Chrome DevTools: console, network requests, performance traces.',
    },
    plans: ['npm:0'],
    server: {
      name: 'io.github.ChromeDevTools/chrome-devtools-mcp',
      title: 'Chrome DevTools MCP',
      description: 'MCP server for Chrome DevTools',
      version: '1.11.0',
      repository: {
        url: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
      },
      packages: [
        {
          registryType: 'npm',
          identifier: 'chrome-devtools-mcp',
          version: '1.11.0',
          transport: {
            type: 'stdio',
          },
        },
      ],
    },
  },
  {
    id: 'exa',
    name: 'Exa',
    category: 'search',
    summary: {
      tr: 'Web araması, sayfa içeriği ve çok adımlı araştırma. Anahtarsız.',
      en: 'Web search, page content and multi-step research. No key.',
    },
    plans: ['remote:0'],
    server: {
      name: 'ai.exa/exa',
      description: 'Connect AI agents to Exa for web search, content fetching, and multi-step research.',
      version: '3.4.1',
      repository: {
        url: 'https://github.com/exa-labs/exa-mcp-server',
      },
      remotes: [
        {
          type: 'streamable-http',
          url: 'https://mcp.exa.ai/mcp',
        },
      ],
    },
  },
  {
    id: 'tavily',
    name: 'Tavily',
    category: 'search',
    summary: {
      tr: 'Ajanlar için web araması ve sayfa çıkarma. Anahtar ister.',
      en: 'Web search and page extraction for agents. Needs a key.',
    },
    plans: ['npm:0'],
    keyUrl: 'https://app.tavily.com',
    server: {
      name: 'io.github.tavily-ai/tavily-mcp',
      description: 'MCP server for advanced web search using Tavily',
      version: '0.2.15',
      repository: {
        url: 'https://github.com/tavily-ai/tavily-mcp',
      },
      packages: [
        {
          registryType: 'npm',
          identifier: 'tavily-mcp',
          version: '0.2.15',
          transport: {
            type: 'stdio',
          },
          environmentVariables: [
            {
              name: 'TAVILY_API_KEY',
              description: 'Your Tavily API key from tavily.com',
              isRequired: true,
              isSecret: true,
              format: 'string',
            },
            {
              name: 'DEFAULT_PARAMETERS',
              description:
                'JSON string with default search parameters (e.g., {"include_images": true, "max_results": 15})',
              format: 'string',
            },
          ],
        },
      ],
    },
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    category: 'search',
    summary: {
      tr: 'Web sayfalarını tarar, kazır ve arar. Anahtarsız katmanı var.',
      en: 'Crawls, scrapes and searches the web. Has a keyless tier.',
    },
    plans: ['remote:0', 'npm:0'],
    keyUrl: 'https://www.firecrawl.dev/app/api-keys',
    server: {
      name: 'io.github.firecrawl/firecrawl-mcp-server',
      title: 'Firecrawl MCP Server',
      description:
        'Firecrawl, the context API for AI agents: search, scrape, interact with the web, plus paper search.',
      version: '3.33.4',
      repository: {
        url: 'https://github.com/firecrawl/firecrawl-mcp-server.git',
      },
      remotes: [
        {
          type: 'streamable-http',
          url: 'https://mcp.firecrawl.dev/v2/mcp',
          headers: [
            {
              name: 'Authorization',
              description: 'Optional. Bearer <FIRECRAWL_API_KEY>. Omit for the keyless tier.',
              isSecret: true,
            },
          ],
        },
      ],
      packages: [
        {
          registryType: 'npm',
          identifier: 'firecrawl-mcp',
          version: '3.33.4',
          transport: {
            type: 'stdio',
          },
          environmentVariables: [
            {
              name: 'FIRECRAWL_API_KEY',
              description: 'Your API key for Firecrawl',
              isSecret: true,
              format: 'string',
            },
          ],
        },
      ],
    },
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    category: 'data',
    summary: {
      tr: "Hugging Face Hub: modeller, veri setleri, Space'ler. Token isteğe bağlı.",
      en: 'Hugging Face Hub: models, datasets, Spaces. Token optional.',
    },
    plans: ['remote:1'],
    keyUrl: 'https://huggingface.co/settings/tokens',
    server: {
      name: 'co.huggingface/hf-mcp-server',
      title: 'Hugging Face',
      description: 'Connect to Hugging Face Hub and thousands of Gradio AI Applications',
      version: '0.2.33',
      remotes: [
        {
          type: 'streamable-http',
          url: 'https://huggingface.co/mcp?login',
        },
        {
          type: 'streamable-http',
          url: 'https://huggingface.co/mcp',
          headers: [
            {
              name: 'Authorization',
              description: 'Hugging Face API token for authentication',
              isSecret: true,
              placeholder: 'Bearer hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
            },
          ],
        },
        {
          type: 'streamable-http',
          url: 'https://huggingface.co/mcp',
        },
      ],
    },
  },
  {
    id: 'supabase',
    name: 'Supabase',
    category: 'data',
    summary: {
      tr: "Supabase projeleri: tablolar, SQL, günlükler. Erişim token'ı ister; salt okunur başlar.",
      en: 'Supabase projects: tables, SQL, logs. Needs an access token; starts read-only.',
    },
    plans: ['npm:0'],
    keyUrl: 'https://supabase.com/dashboard/account/tokens',
    defaults: {
      'read-only': 'true',
    },
    server: {
      name: 'com.supabase/mcp',
      title: 'Supabase',
      description: 'MCP server for interacting with the Supabase platform',
      version: '0.14.0',
      websiteUrl: 'https://supabase.com/mcp',
      repository: {
        url: 'https://github.com/supabase/mcp',
      },
      remotes: [
        {
          type: 'streamable-http',
          url: 'https://mcp.supabase.com/mcp',
        },
      ],
      packages: [
        {
          registryType: 'npm',
          identifier: '@supabase/mcp-server-supabase',
          version: '0.14.0',
          runtimeHint: 'npx',
          transport: {
            type: 'stdio',
          },
          runtimeArguments: [
            {
              name: '--project-ref',
              description: 'Supabase project reference ID',
              format: 'string',
              type: 'named',
            },
            {
              name: '--read-only',
              description: 'Enable read-only mode',
              format: 'boolean',
              type: 'named',
            },
            {
              name: '--features',
              description: 'Comma-separated list of features to enable',
              format: 'string',
              type: 'named',
            },
            {
              name: '--api-url',
              description: 'Custom API URL',
              format: 'string',
              type: 'named',
            },
          ],
          environmentVariables: [
            {
              name: 'SUPABASE_ACCESS_TOKEN',
              description: 'Personal access token for Supabase API',
              isRequired: true,
              isSecret: true,
              format: 'string',
            },
          ],
        },
      ],
    },
  },
  {
    id: 'sentry',
    name: 'Sentry',
    category: 'ops',
    summary: {
      tr: "Sentry hataları, issue'lar ve izler. Kimlik doğrulama token'ı ister.",
      en: 'Sentry errors, issues and traces. Needs an auth token.',
    },
    plans: ['npm:0'],
    keyUrl: 'https://sentry.io/settings/account/api/auth-tokens/',
    server: {
      name: 'io.github.getsentry/sentry-mcp',
      description: 'MCP server for Sentry - error monitoring, issue tracking, and debugging for AI assistants',
      version: '0.42.0',
      repository: {
        url: 'https://github.com/getsentry/sentry-mcp',
      },
      remotes: [
        {
          type: 'streamable-http',
          url: 'https://mcp.sentry.dev/mcp',
        },
      ],
      packages: [
        {
          registryType: 'npm',
          identifier: '@sentry/mcp-server',
          version: '0.42.0',
          transport: {
            type: 'stdio',
          },
          environmentVariables: [
            {
              name: 'SENTRY_ACCESS_TOKEN',
              description: 'Your Sentry user authentication token',
              isRequired: true,
              isSecret: true,
              format: 'string',
            },
          ],
        },
      ],
    },
  },
];
