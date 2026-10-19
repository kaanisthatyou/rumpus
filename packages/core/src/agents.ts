// Finds the CLI agents installed on this computer and reads their login state without spending tokens.
// Lonca never reads or copies a CLI's credential files: it only runs the CLI's own status command.
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CliInfo, CliKind, CliState } from '@lonca/protocol';
import { run as defaultRun, type Runner, type RunResult, which } from './proc.js';

interface AuthReading {
  state: CliState;
  auth?: string;
  plan?: string;
}

interface KindSpec {
  kind: CliKind;
  bin: string;
  extraDirs: (ctx: Ctx) => string[];
  /** Reads the login state; absent for CLIs that Lonca runs with an API key only. */
  authArgs?: string[];
  parseAuth?: (r: RunResult, ctx: Ctx) => AuthReading;
  /** API-key-only CLIs: ready when one of these is set (Google forbids third-party use of its OAuth login). */
  keyEnv?: string[];
  loginArgs?: string[];
  install: CliInfo['install'];
}

interface Ctx {
  home: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}

const VERSION_RE = /\d+\.\d+\.\d+(?:[-+][\w.]+)?/;

export function parseVersion(text: string): string | undefined {
  return VERSION_RE.exec(text)?.[0];
}

function hasEnv(ctx: Ctx, keys: readonly string[]): string | undefined {
  return keys.find((k) => (ctx.env[k] ?? '').trim() !== '');
}

/** `claude auth status --json`: `{ loggedIn, authMethod, subscriptionType, ... }`. Email and ids are dropped. */
export function parseClaudeAuth(r: RunResult): AuthReading {
  try {
    const data = JSON.parse(r.stdout) as { loggedIn?: unknown; authMethod?: unknown; subscriptionType?: unknown };
    if (typeof data.loggedIn !== 'boolean') return { state: 'unknown' };
    if (!data.loggedIn) return { state: 'signed-out' };
    const method = typeof data.authMethod === 'string' ? data.authMethod : '';
    const auth = method === 'claude.ai' ? 'subscription' : /api|console|key/i.test(method) ? 'api-key' : method;
    const plan = typeof data.subscriptionType === 'string' ? data.subscriptionType : undefined;
    return { state: 'ready', ...(auth ? { auth } : {}), ...(plan ? { plan } : {}) };
  } catch {
    return { state: 'unknown' };
  }
}

/**
 * `codex login status`: "Logged in using ChatGPT" / "... an API key" when signed in. "Not logged in" also exits 0
 * (seen with codex-cli 0.162.1), so the text decides, not the exit code.
 */
export function parseCodexAuth(r: RunResult, ctx: Ctx): AuthReading {
  const text = `${r.stdout}\n${r.stderr}`;
  if (/not logged in/i.test(text)) {
    return hasEnv(ctx, ['CODEX_API_KEY']) ? { state: 'ready', auth: 'api-key' } : { state: 'signed-out' };
  }
  if (r.code === 0 && /logged in/i.test(text)) {
    return { state: 'ready', auth: /api key/i.test(text) ? 'api-key' : 'subscription' };
  }
  if (hasEnv(ctx, ['CODEX_API_KEY'])) return { state: 'ready', auth: 'api-key' };
  if (/not logged in/i.test(text) || (r.code !== null && r.code !== 0)) return { state: 'signed-out' };
  return { state: 'unknown' };
}

/** `opencode auth list`: counts stored credentials. (Format from the docs, not yet seen.) */
export function parseOpenCodeAuth(r: RunResult): AuthReading {
  if (r.code !== 0) return { state: 'unknown' };
  const count = /(\d+)\s+credentials?/i.exec(r.stdout);
  if (count) return Number(count[1]) > 0 ? { state: 'ready' } : { state: 'signed-out' };
  return /●/.test(r.stdout) ? { state: 'ready' } : { state: 'unknown' };
}

const GOOGLE_KEYS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI'];

export const SPECS: readonly KindSpec[] = [
  {
    kind: 'claude-code',
    bin: 'claude',
    extraDirs: ({ home }) => [join(home, '.local', 'bin'), join(home, '.claude', 'local')],
    authArgs: ['auth', 'status', '--json'],
    parseAuth: parseClaudeAuth,
    loginArgs: ['auth', 'login'],
    install: {
      windows: 'irm https://claude.ai/install.ps1 | iex',
      linux: 'curl -fsSL https://claude.ai/install.sh | bash',
      docs: 'https://code.claude.com/docs/en/setup',
    },
  },
  {
    kind: 'codex',
    bin: 'codex',
    extraDirs: ({ home }) => [join(home, '.local', 'bin')],
    authArgs: ['login', 'status'],
    parseAuth: parseCodexAuth,
    loginArgs: ['login'],
    install: {
      windows: 'npm install -g @openai/codex',
      linux: 'npm install -g @openai/codex',
      docs: 'https://github.com/openai/codex',
    },
  },
  {
    kind: 'opencode',
    bin: 'opencode',
    extraDirs: ({ home }) => [join(home, '.opencode', 'bin'), join(home, '.local', 'bin')],
    authArgs: ['auth', 'list'],
    parseAuth: parseOpenCodeAuth,
    loginArgs: ['auth', 'login'],
    install: {
      windows: 'npm install -g opencode-ai',
      linux: 'npm install -g opencode-ai',
      docs: 'https://opencode.ai/docs/',
    },
  },
  {
    kind: 'gemini',
    bin: 'gemini',
    extraDirs: () => [],
    keyEnv: GOOGLE_KEYS,
    install: {
      windows: 'npm install -g @google/gemini-cli',
      linux: 'npm install -g @google/gemini-cli',
      docs: 'https://github.com/google-gemini/gemini-cli',
    },
  },
  {
    kind: 'antigravity',
    bin: 'agy',
    extraDirs: ({ home, env, platform }) =>
      platform === 'win32'
        ? [join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'agy', 'bin')]
        : [join(home, '.local', 'bin')],
    keyEnv: GOOGLE_KEYS,
    install: {
      windows: 'irm https://antigravity.google/cli/install.ps1 | iex',
      linux: '',
      docs: 'https://antigravity.google/docs/cli/headless/',
    },
  },
];

export interface DetectOptions {
  runner?: Runner;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
}

async function detectOne(spec: KindSpec, ctx: Ctx, runner: Runner): Promise<CliInfo> {
  const base = {
    kind: spec.kind,
    canLogin: spec.loginArgs !== undefined,
    install: spec.install,
  };
  const path = which(spec.bin, spec.extraDirs(ctx), ctx.env, ctx.platform);
  if (!path) return { ...base, state: 'missing', canLogin: false };
  const [versionRun, authRun] = await Promise.all([
    runner(path, ['--version'], { timeoutMs: 8000, env: ctx.env }),
    spec.authArgs ? runner(path, spec.authArgs, { timeoutMs: 10_000, env: ctx.env }) : Promise.resolve(undefined),
  ]);
  const version = parseVersion(`${versionRun.stdout}\n${versionRun.stderr}`);
  let reading: AuthReading;
  if (spec.keyEnv) {
    const key = hasEnv(ctx, spec.keyEnv);
    reading = key
      ? { state: 'ready', auth: key === 'GOOGLE_GENAI_USE_VERTEXAI' ? 'vertex' : 'api-key' }
      : { state: 'needs-key' };
  } else if (authRun && spec.parseAuth && !authRun.timedOut && !authRun.failed) {
    reading = spec.parseAuth(authRun, ctx);
  } else {
    reading = { state: 'unknown' };
  }
  return {
    ...base,
    path,
    ...(version ? { version } : {}),
    ...reading,
  };
}

/** The login state of one CLI under another config folder (an account), read with the CLI's own status command. */
export async function readLogin(
  kind: CliKind,
  path: string,
  env: NodeJS.ProcessEnv,
  runner: Runner = defaultRun,
): Promise<{ state: CliState; auth?: string; plan?: string }> {
  const spec = SPECS.find((s) => s.kind === kind);
  if (!spec?.authArgs || !spec.parseAuth) return { state: 'unknown' };
  const r = await runner(path, spec.authArgs, { timeoutMs: 10_000, env });
  if (r.timedOut || r.failed) return { state: 'unknown' };
  return spec.parseAuth(r, { home: homedir(), env, platform: process.platform });
}

export async function detectAgents(opts: DetectOptions = {}): Promise<CliInfo[]> {
  const ctx: Ctx = {
    home: opts.home ?? homedir(),
    env: opts.env ?? process.env,
    platform: opts.platform ?? process.platform,
  };
  const runner = opts.runner ?? defaultRun;
  return Promise.all(SPECS.map((spec) => detectOne(spec, ctx, runner)));
}

export function loginCommand(kind: CliKind): string[] | undefined {
  return SPECS.find((s) => s.kind === kind)?.loginArgs;
}
