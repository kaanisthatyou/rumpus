import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Frame, Response } from '@lonca/protocol';
import { describe, expect, it } from 'vitest';
import { Core, type Peer } from '../src/index.js';
import { parseTailscaleStatus } from '../src/tailscale.js';

function fakePeer() {
  let listener: (frame: unknown) => void = () => {};
  const sent: Frame[] = [];
  const peer: Peer = {
    send: (f) => sent.push(f),
    onFrame: (l) => {
      listener = l;
    },
  };
  let next = 1;
  const call = async (method: string, params?: unknown): Promise<Response> => {
    const id = next++;
    listener({ id, method, params });
    for (let i = 0; i < 200; i++) {
      const hit = sent.find((f) => 'id' in f && f.id === id && ('result' in f || 'error' in f));
      if (hit) return hit as Response;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`no answer to ${method}`);
  };
  return { peer, sent, call };
}

function newCore(appDir = mkdtempSync(join(tmpdir(), 'lonca-core-'))) {
  const opened: string[][] = [];
  const core = new Core({
    appDir,
    language: 'tr',
    env: { PATH: '' },
    platform: 'linux',
    runner: async () => ({ code: 0, stdout: '', stderr: '', timedOut: false }),
    openConsole: (file, args) => {
      opened.push([file, ...args]);
      return true;
    },
  });
  const p = fakePeer();
  core.attach(p.peer);
  return { core, appDir, opened, ...p };
}

describe('Core', () => {
  it('starts with defaults in the given language', async () => {
    const { call } = newCore();
    const r = await call('settings.get');
    expect(r).toMatchObject({ result: { language: 'tr', theme: 'dark', accent: 'lime', onboarded: false } });
  });

  it('saves valid changes, tells every client, and keeps them across restarts', async () => {
    const { call, sent, appDir } = newCore();
    const r = await call('settings.update', { accent: 'blue', profile: { name: 'Kaan' } });
    expect(r).toMatchObject({ result: { accent: 'blue', profile: { name: 'Kaan' } } });
    expect(sent.some((f) => 'event' in f && f.event === 'settings.changed')).toBe(true);
    const again = newCore(appDir);
    expect(await again.call('settings.get')).toMatchObject({ result: { accent: 'blue', profile: { name: 'Kaan' } } });
  });

  it('changes only the settings a patch names (defaulted fields are not reset)', async () => {
    const { call } = newCore();
    await call('settings.update', { shortcuts: { palette: 'Ctrl+J' }, quietHours: { from: '22:00', to: '07:00' } });
    const r = await call('settings.update', { accent: 'violet' });
    expect(r).toMatchObject({
      result: { accent: 'violet', shortcuts: { palette: 'Ctrl+J' }, quietHours: { from: '22:00', to: '07:00' } },
    });
  });

  it('refuses invalid settings with a code', async () => {
    const { call } = newCore();
    expect(await call('settings.update', { accent: 'pink' })).toMatchObject({ error: { code: 'invalid_settings' } });
    expect(await call('settings.update', { profile: { name: 'x'.repeat(41) } })).toMatchObject({
      error: { code: 'invalid_settings' },
    });
  });

  it('survives a damaged settings file', async () => {
    const appDir = mkdtempSync(join(tmpdir(), 'lonca-core-'));
    writeFileSync(join(appDir, 'settings.json'), '{ not json');
    const { call } = newCore(appDir);
    expect(await call('settings.get')).toMatchObject({ result: { v: 1, language: 'tr' } });
    await call('settings.update', { theme: 'light' });
    expect(JSON.parse(readFileSync(join(appDir, 'settings.json'), 'utf8')).theme).toBe('light');
  });

  it('answers unknown methods and bad requests with codes', async () => {
    const { call } = newCore();
    expect(await call('nope')).toMatchObject({ error: { code: 'unknown_method' } });
    expect(await call('clis.login', { kind: 'rm -rf' })).toMatchObject({ error: { code: 'bad_request' } });
    expect(await call('clis.login', { kind: 'claude-code' })).toMatchObject({ error: { code: 'not_installed' } });
  });

  it('lists agents and reports the default data folder', async () => {
    const { call, appDir } = newCore();
    const agents = await call('clis.list');
    expect('result' in agents && Array.isArray(agents.result)).toBe(true);
    expect(await call('system.info')).toMatchObject({ result: { dataDir: join(appDir, 'data') } });
  });
});

describe('parseTailscaleStatus', () => {
  const r = (stdout: string) => ({ code: 0, stdout, stderr: '', timedOut: false });
  it('reads the running state and the IPv4 address', () => {
    expect(
      parseTailscaleStatus(
        r(
          JSON.stringify({ BackendState: 'Running', Self: { HostName: 'pc', TailscaleIPs: ['100.1.2.3', 'fd7a::1'] } }),
        ),
      ),
    ).toEqual({ state: 'running', ip: '100.1.2.3', host: 'pc' });
  });
  it('maps login and stopped states', () => {
    expect(parseTailscaleStatus(r(JSON.stringify({ BackendState: 'NeedsLogin' }))).state).toBe('needs-login');
    expect(parseTailscaleStatus(r('failed to connect to local Tailscale service')).state).toBe('stopped');
  });
});
