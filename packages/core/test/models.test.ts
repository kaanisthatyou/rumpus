import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listModels, parseClaudeModels, parseCodexModels } from '../src/models.js';

describe('CLI model lists', () => {
  it("reads Claude Code's model menu, names its default and drops the default entry", () => {
    const list = parseClaudeModels({
      models: [
        {
          value: 'default',
          resolvedModel: 'claude-fable-5-2',
          displayName: 'Default (recommended)',
          description: 'Fable 5.2',
        },
        { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: 'For complex work' },
        { value: 'fable', resolvedModel: 'claude-fable-5-2', displayName: 'Fable 5.2' },
        { value: 'claude-opus-4-8', displayName: 'Opus 4.8' },
        { value: 'opus', displayName: 'Duplicate' },
        { displayName: 'No value' },
      ],
    });
    expect(list.defaultName).toBe('Fable 5.2');
    expect(list.models).toEqual([
      { id: 'opus', name: 'Opus 5.5', description: 'For complex work' },
      { id: 'fable', name: 'Fable 5.2' },
      { id: 'claude-opus-4-8', name: 'Opus 4.8' },
    ]);
    expect(parseClaudeModels(undefined)).toEqual({ models: [] });
  });

  it("reads a page of Codex's model/list, skipping hidden models", () => {
    const page = parseCodexModels({
      data: [
        { id: 'gpt-6-sol', model: 'gpt-6-sol', displayName: 'GPT-6-Sol', description: 'Workhorse', isDefault: true },
        { id: 'secret', model: 'secret', displayName: 'Secret', hidden: true },
        { model: 'gpt-6-luna', displayName: 'GPT-6-Luna' },
      ],
      nextCursor: 'abc',
    });
    expect(page).toEqual({
      models: [
        { id: 'gpt-6-sol', name: 'GPT-6-Sol', description: 'Workhorse' },
        { id: 'gpt-6-luna', name: 'GPT-6-Luna' },
      ],
      defaultName: 'GPT-6-Sol',
      next: 'abc',
    });
  });

  it('asks the stand-in Claude Code for its models and stops it', async () => {
    const fake = fileURLToPath(new URL('../../../apps/desktop/e2e/fake-claude.mjs', import.meta.url));
    const list = await listModels('claude-code', { file: process.execPath, args: [fake] }, undefined, 15_000);
    expect(list.defaultName).toBe('Large 2');
    expect(list.models.map((m) => m.id)).toEqual(['large', 'small', 'fake-large-1']);
  }, 20_000);

  it('gives an empty list when the CLI never answers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lonca-models-'));
    const silent = join(dir, 'silent.mjs');
    writeFileSync(silent, 'process.stdin.resume();\n');
    expect(await listModels('codex', { file: process.execPath, args: [silent] }, undefined, 500)).toEqual({
      models: [],
    });
    expect(await listModels('opencode', { file: process.execPath, args: [silent] }, undefined, 500)).toEqual({
      models: [],
    });
  }, 10_000);
});
