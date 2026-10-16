import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run, which } from '../src/proc.js';

describe('which', () => {
  it('prefers a real .exe over a .cmd shim in the same folder on Windows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lonca-which-'));
    writeFileSync(join(dir, 'tool.cmd'), '');
    writeFileSync(join(dir, 'tool.exe'), '');
    expect(which('tool', [], { PATH: dir, PATHEXT: '.CMD;.EXE' }, 'win32')).toBe(join(dir, 'tool.exe'));
  });

  it('follows PATH order, then the extra folders', () => {
    const a = mkdtempSync(join(tmpdir(), 'lonca-a-'));
    const b = mkdtempSync(join(tmpdir(), 'lonca-b-'));
    writeFileSync(join(b, 'tool'), '');
    expect(which('tool', [], { PATH: a }, 'linux')).toBeUndefined();
    expect(which('tool', [b], { PATH: a }, 'linux')).toBe(join(b, 'tool'));
  });

  it('ignores folders with the same name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lonca-dir-'));
    mkdirSync(join(dir, 'tool'));
    expect(which('tool', [], { PATH: dir }, 'linux')).toBeUndefined();
  });

  it('reads Path in any letter case', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lonca-case-'));
    writeFileSync(join(dir, 'tool.exe'), '');
    expect(which('tool', [], { Path: dir }, 'win32')).toBe(join(dir, 'tool.exe'));
  });
});

describe('run', () => {
  it('collects output and the exit code', async () => {
    const r = await run(process.execPath, ['-e', 'process.stdout.write("hi"); process.exit(3)']);
    expect(r).toMatchObject({ code: 3, stdout: 'hi', timedOut: false });
  });

  it('stops a program that runs too long', async () => {
    const r = await run(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
  });

  it('reports a program that cannot start', async () => {
    const r = await run(join(tmpdir(), 'lonca-does-not-exist'), []);
    expect(r.failed ?? r.code !== 0).toBe(true);
  });
});
