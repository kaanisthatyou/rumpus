// Contract tests against real CLIs, run only when pointed at one (they start the CLI, but spend no tokens:
// no login is needed for what they check). LONCA_REAL_CODEX=<folder with the codex executable or npm shim>.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectAgents } from '../src/agents.js';
import { openCodex } from '../src/drivers/codex.js';
import type { DriverEvent } from '../src/drivers/types.js';
import { Gateway } from '../src/gateway.js';
import { resolveLaunch, which } from '../src/proc.js';

const bin = process.env.LONCA_REAL_CODEX;

describe.skipIf(!bin)('real Codex CLI', () => {
  const env = {
    ...process.env,
    PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
    CODEX_HOME: mkdtempSync(join(tmpdir(), 'lonca-codex-home-')),
  };

  it('is found, reports its version and a missing login', async () => {
    const codex = (await detectAgents({ env })).find((a) => a.kind === 'codex');
    expect(codex?.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(codex?.state).toBe('signed-out');
  }, 60_000);

  it('accepts the exec flags, reaches the Lonca MCP endpoint, and ends a turn it cannot run with a login failure', async () => {
    const path = which('codex', [bin ?? ''], env);
    expect(path).toBeTruthy();
    const gateway = new Gateway([]);
    await gateway.start();
    const token = gateway.issue({ agentId: 'a', channelId: 'c' });
    const events: DriverEvent[] = [];
    const done = new Promise<void>((resolve) => {
      const session = openCodex(
        {
          launch: resolveLaunch(path ?? ''),
          cwd: mkdtempSync(join(tmpdir(), 'lonca-codex-work-')),
          mode: 'read',
          systemPrompt: 'probe',
          env,
          mcp: { url: gateway.url(), token },
        },
        (e) => {
          events.push(e);
          if (e.type === 'end' || e.type === 'exit') resolve();
        },
      );
      session.send('hi');
    });
    await done;
    gateway.close();
    expect(gateway.served).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'session')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'end', ok: false });
    expect(events.some((e) => e.type === 'auth_failed')).toBe(true);
  }, 120_000);
});
