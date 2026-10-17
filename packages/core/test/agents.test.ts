import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectAgents, parseClaudeAuth, parseCodexAuth, parseOpenCodeAuth, parseVersion } from '../src/agents.js';
import type { Runner, RunResult } from '../src/proc.js';

const ok = (stdout: string, code = 0): RunResult => ({ code, stdout, stderr: '', timedOut: false });

function fakeBins(names: string[], platform: NodeJS.Platform): string {
  const dir = mkdtempSync(join(tmpdir(), 'lonca-bin-'));
  for (const n of names) writeFileSync(join(dir, platform === 'win32' ? `${n}.exe` : n), '');
  return dir;
}

describe('parsers', () => {
  it('reads versions out of CLI banners', () => {
    expect(parseVersion('2.1.301 (Claude Code)')).toBe('2.1.301');
    expect(parseVersion('codex-cli 0.163.0')).toBe('0.163.0');
    expect(parseVersion('no version here')).toBeUndefined();
  });

  it('keeps only login state, method and plan from claude auth status', () => {
    const r = ok(
      JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro', email: 'a@b.c', orgId: 'x' }),
    );
    expect(parseClaudeAuth(r)).toEqual({ state: 'ready', auth: 'subscription', plan: 'pro' });
    expect(parseClaudeAuth(ok(JSON.stringify({ loggedIn: false })))).toEqual({ state: 'signed-out' });
    expect(parseClaudeAuth(ok('not json'))).toEqual({ state: 'unknown' });
  });

  it('reads codex login status', () => {
    const ctx = { home: '', env: {}, platform: 'linux' as const };
    expect(parseCodexAuth(ok('Logged in using ChatGPT'), ctx)).toEqual({ state: 'ready', auth: 'subscription' });
    expect(parseCodexAuth(ok('Logged in using an API key'), ctx)).toEqual({ state: 'ready', auth: 'api-key' });
    expect(parseCodexAuth(ok('Not logged in', 1), ctx)).toEqual({ state: 'signed-out' });
    // codex-cli 0.162.1 says it with exit code 0.
    expect(parseCodexAuth(ok('Not logged in', 0), ctx)).toEqual({ state: 'signed-out' });
    expect(parseCodexAuth(ok('Not logged in', 1), { ...ctx, env: { CODEX_API_KEY: 'k' } })).toEqual({
      state: 'ready',
      auth: 'api-key',
    });
  });

  it('reads opencode credential counts', () => {
    expect(parseOpenCodeAuth(ok('~/.local/share/opencode/auth.json\n2 credentials'))).toEqual({ state: 'ready' });
    expect(parseOpenCodeAuth(ok('0 credentials'))).toEqual({ state: 'signed-out' });
    expect(parseOpenCodeAuth(ok('', 1))).toEqual({ state: 'unknown' });
  });
});

describe('detectAgents', () => {
  for (const platform of ['win32', 'linux'] as const) {
    it(`finds installed CLIs and reports the rest as missing (${platform})`, async () => {
      const dir = fakeBins(['claude', 'gemini'], platform);
      const calls: string[][] = [];
      const runner: Runner = async (file, args) => {
        calls.push([file, ...args]);
        if (args[0] === '--version') return ok('2.1.301 (Claude Code)');
        if (args.join(' ') === 'auth status --json')
          return ok(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }));
        return ok('');
      };
      const home = mkdtempSync(join(tmpdir(), 'lonca-home-'));
      mkdirSync(join(home, '.local', 'bin'), { recursive: true });
      const agents = await detectAgents({ runner, env: { PATH: dir, PATHEXT: '.EXE;.CMD' }, platform, home });
      const byKind = Object.fromEntries(agents.map((a) => [a.kind, a]));
      expect(byKind['claude-code']).toMatchObject({
        state: 'ready',
        version: '2.1.301',
        auth: 'subscription',
        canLogin: true,
      });
      expect(byKind.gemini).toMatchObject({ state: 'needs-key', canLogin: false });
      expect(byKind.codex).toMatchObject({ state: 'missing', canLogin: false });
      expect(byKind.opencode?.state).toBe('missing');
      expect(byKind.antigravity?.state).toBe('missing');
      // Gemini is API-key only: its login state is never queried.
      expect(calls.filter((c) => c[0]?.includes('gemini') && c[1] !== '--version')).toEqual([]);
    });
  }

  it('treats a Google API key as ready for gemini', async () => {
    const dir = fakeBins(['gemini'], 'linux');
    const agents = await detectAgents({
      runner: async () => ok('0.64.0'),
      env: { PATH: dir, GEMINI_API_KEY: 'k' },
      platform: 'linux',
      home: tmpdir(),
    });
    expect(agents.find((a) => a.kind === 'gemini')).toMatchObject({
      state: 'ready',
      auth: 'api-key',
      version: '0.64.0',
    });
  });

  it('reports unknown when the status command times out', async () => {
    const dir = fakeBins(['claude'], 'linux');
    const agents = await detectAgents({
      runner: async (_f, args) =>
        args[0] === '--version' ? ok('2.1.0') : { code: null, stdout: '', stderr: '', timedOut: true },
      env: { PATH: dir },
      platform: 'linux',
      home: tmpdir(),
    });
    expect(agents.find((a) => a.kind === 'claude-code')?.state).toBe('unknown');
  });
});
