import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Frame, ProjectView, RecordItem, Response } from '@lonca/protocol';
import { describe, expect, it } from 'vitest';
import { frontMatter, readFabrika } from '../src/fabrika.js';
import { Core } from '../src/server.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function fabrika(): string {
  const root = tmp('lonca-fabrika-');
  mkdirSync(join(root, 'ideas'));
  writeFileSync(join(root, 'ideas', 'README.md'), '# Ideas\n');
  writeFileSync(
    join(root, 'ideas', '20261009-030000-rake-all-the-leaves.md'),
    '---\ntitle: Rake all the leaves\nkind: game            # game | feature\nstatus: planned\ntags: [cozy, idle]\n---\nA cozy raking game.\n',
  );
  mkdirSync(join(root, 'references'));
  writeFileSync(join(root, 'references', 'egg.png'), Buffer.from(PNG_1X1, 'base64'));
  writeFileSync(
    join(root, 'references', 'egg.json'),
    JSON.stringify({
      title: 'Steal An Egg',
      source: 'https://www.roblox.com/games/1',
      tags: ['steal'],
      note: 'The top game.',
      file: 'egg.png',
    }),
  );
  mkdirSync(join(root, '.claude', 'commands'), { recursive: true });
  writeFileSync(join(root, '.claude', 'commands', 'research.md'), 'Research $ARGUMENTS and write a report.\n');
  mkdirSync(join(root, 'games', 'cowfarm'), { recursive: true });
  writeFileSync(join(root, 'games', 'cowfarm', 'README.md'), '# CowFarm\n\n**Status:** live\n');
  writeFileSync(
    join(root, 'games', 'cowfarm', 'progress.md'),
    '# CowFarm — progress\n\n## Where we left off\n\nPublished.\n\n## Milestones\n\n- [x] Published\n\n## Next\n\n1. Halloween event\n',
  );
  mkdirSync(join(root, 'games', 'empty'));
  return root;
}

describe('Fabrika import', () => {
  it('reads front matter and a Fabrika folder', () => {
    expect(frontMatter('---\ntitle: A\ntags: [x, "y"]\n---\nbody')).toEqual({
      meta: { title: 'A', tags: ['x', 'y'] },
      body: 'body',
    });
    const c = readFabrika(fabrika());
    expect(c.ideas).toEqual([
      { title: 'Rake all the leaves', body: 'A cozy raking game.', tags: ['cozy', 'idle', 'game'], status: 'later' },
    ]);
    expect(c.references[0]).toMatchObject({ title: 'Steal An Egg', tags: ['steal'] });
    expect(c.references[0]?.body).toContain('https://www.roblox.com/games/1');
    expect(c.references[0]?.imageData.startsWith('data:image/png;base64,')).toBe(true);
    expect(c.commands).toEqual([{ title: 'research', body: 'Research $ARGUMENTS and write a report.' }]);
    expect(c.games.map((g) => g.name)).toEqual(['CowFarm']);
  });

  it('turns it into records and projects once, without waking advisors', async () => {
    const bin = tmp('lonca-bin-');
    const core = new Core({ appDir: tmp('lonca-fab-app-'), language: 'en', env: { PATH: bin }, platform: 'linux' });
    let listener: (f: unknown) => void = () => {};
    const sent: Frame[] = [];
    core.attach({ send: (f) => sent.push(f), onFrame: (l) => (listener = l) });
    let id = 0;
    const call = async <T>(method: string, params?: unknown): Promise<T> => {
      const rid = ++id;
      listener({ id: rid, method, params });
      for (let i = 0; i < 1000; i++) {
        const r = sent.find((f) => 'id' in f && f.id === rid && ('result' in f || 'error' in f)) as
          | Response
          | undefined;
        if (r) {
          if ('error' in r) throw new Error(r.error.code);
          return r.result as T;
        }
        await new Promise((res) => setTimeout(res, 5));
      }
      throw new Error(`no answer: ${method}`);
    };
    const root = fabrika();
    await expect(call('fabrika.import', { folder: tmp('lonca-empty-') })).rejects.toThrow('not_fabrika');
    expect(await call('fabrika.import', { folder: root })).toEqual({
      ideas: 1,
      references: 1,
      commands: 1,
      projects: 1,
      skipped: 0,
    });
    const records = await call<RecordItem[]>('records.list', {});
    expect(records.map((r) => `${r.kind}:${r.title}`).sort()).toEqual([
      'command:research',
      'idea:Rake all the leaves',
      'reference:Steal An Egg',
    ]);
    const [project] = await call<ProjectView[]>('projects.list');
    expect(project).toMatchObject({ name: 'CowFarm', status: { leftOff: 'Published.', next: ['Halloween event'] } });
    expect(await call('fabrika.import', { folder: root })).toMatchObject({ ideas: 0, projects: 0, skipped: 4 });
    core.shutdown();
  });
});
