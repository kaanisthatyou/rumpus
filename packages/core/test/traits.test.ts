import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AGENT_TRAITS,
  type Agent,
  cleanTraits,
  type Frame,
  type Response,
  SettingsSchema,
  TRAITS_MAX,
  toggleTrait,
  traitsPrompt,
} from '@lonca/protocol';
import { describe, expect, it } from 'vitest';
import { systemPrompt } from '../src/prompts.js';
import { Core } from '../src/server.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

function setup(desktopDir?: string) {
  const core = new Core({
    appDir: tmp('lonca-app-'),
    language: 'tr',
    env: { PATH: '' },
    platform: 'linux',
    runner: async () => ({ code: 0, stdout: '', stderr: '', timedOut: false }),
    ...(desktopDir ? { desktopDir } : {}),
  });
  let listener: (f: unknown) => void = () => {};
  const sent: Frame[] = [];
  core.attach({ send: (f) => sent.push(f), onFrame: (l) => (listener = l) });
  let id = 0;
  const call = async <T>(method: string, params?: unknown): Promise<T> => {
    const rid = ++id;
    listener({ id: rid, method, params });
    for (let i = 0; i < 400; i++) {
      const r = sent.find((f) => 'id' in f && f.id === rid && ('result' in f || 'error' in f)) as Response | undefined;
      if (r) {
        if ('error' in r) throw new Error(r.error.code);
        return r.result as T;
      }
      await new Promise((res) => setTimeout(res, 5));
    }
    throw new Error(`no answer: ${method}`);
  };
  return { core, call };
}

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: 'a1',
  kind: 'claude-code',
  name: 'Claude',
  handle: 'claude',
  folder: '/work',
  mode: 'read',
  instructions: '',
  created: 1,
  ...over,
});

describe('character presets', () => {
  it('have unique ids, a prompt each, and opposites that name each other', () => {
    const ids = AGENT_TRAITS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of AGENT_TRAITS) {
      expect(t.prompt.length).toBeGreaterThan(60);
      for (const other of t.excludes) {
        expect(AGENT_TRAITS.find((x) => x.id === other)?.excludes).toContain(t.id);
      }
    }
  });

  it('keeps known ids in catalog order, lets the later pick win over its opposite, and caps the count', () => {
    expect(cleanTraits(['tests', 'nope', 'careful', 'tests'])).toEqual(['careful', 'tests']);
    expect(cleanTraits(['careful', 'fast'])).toEqual(['fast']);
    expect(cleanTraits(['fast', 'careful'])).toEqual(['careful']);
    expect(cleanTraits(undefined)).toEqual([]);
    expect(cleanTraits(AGENT_TRAITS.map((t) => t.id)).length).toBeLessThanOrEqual(TRAITS_MAX);
  });

  it('toggles like a click: on, off, and the opposite goes', () => {
    expect(toggleTrait([], 'asks')).toEqual(['asks']);
    expect(toggleTrait(['asks'], 'asks')).toEqual([]);
    expect(toggleTrait(['asks', 'tests'], 'independent')).toEqual(['independent', 'tests']);
  });

  it('go into the prompt as the owner layer, before the owner words, and never for unknown ids', () => {
    expect(traitsPrompt([])).toBe('');
    expect(traitsPrompt(['nope'])).toBe('');
    const text = systemPrompt(agent({ traits: ['careful', 'brief'], instructions: 'Use pnpm.' }), {
      user: 'Kaan',
      language: 'tr',
    });
    expect(text).toContain('Character (picked by your owner');
    expect(text).toContain('- Thorough.');
    expect(text).toContain('- Few words.');
    expect(text.indexOf('Character (picked')).toBeLessThan(text.indexOf('Instructions from your owner'));
    expect(systemPrompt(agent(), { user: 'Kaan', language: 'tr' })).not.toContain('Character (picked');
  });
});

describe('an agent without a picked folder', () => {
  it('works on the desktop, or in the folder set in Settings', async () => {
    const desktop = tmp('lonca-desktop-');
    const { call } = setup(desktop);
    expect(await call<{ agentFolder: string }>('system.info')).toMatchObject({ agentFolder: desktop });
    const first = await call<Agent>('agents.save', {
      kind: 'claude-code',
      name: 'Claude',
      handle: 'claude',
      mode: 'read',
    });
    expect(first.folder).toBe(desktop);
    expect(first.traits).toBeUndefined();

    const own = tmp('lonca-own-');
    await call('settings.update', { agentFolder: own });
    expect(await call<{ agentFolder: string }>('system.info')).toMatchObject({ agentFolder: own });
    const second = await call<Agent>('agents.save', {
      kind: 'claude-code',
      name: 'İkinci',
      handle: 'ikinci',
      folder: '',
      mode: 'read',
      traits: ['fast', 'careful', 'yok'],
    });
    expect(second.folder).toBe(own);
    expect(second.traits).toEqual(['careful']);
    expect(await call<string>('instructions.preview', { agentId: second.id })).toContain('- Thorough.');

    // A folder that is picked still has to exist; a default that is gone falls back to the desktop.
    await expect(
      call('agents.save', { kind: 'claude-code', name: 'X', handle: 'x', folder: join(own, 'yok'), mode: 'read' }),
    ).rejects.toThrow('folder_missing');
    await call('settings.update', { agentFolder: join(own, 'yok') });
    expect(await call<{ agentFolder: string }>('system.info')).toMatchObject({ agentFolder: desktop });
  });
});

describe('settings from before the look options', () => {
  it('get the defaults', () => {
    const old = {
      v: 1,
      language: 'tr',
      theme: 'dark',
      accent: 'lime',
      motion: 'system',
      profile: { name: 'Kaan' },
      dataDir: '',
      onboarded: true,
    };
    expect(SettingsSchema.parse(old)).toMatchObject({
      textSize: 'normal',
      density: 'comfortable',
      clock: '24',
      startView: 'last',
      crew: 'panel',
      sidebar: true,
      notifications: true,
      sounds: true,
      agentFolder: '',
    });
  });
});
