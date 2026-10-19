import { spawn as nodeSpawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import spawn from 'cross-spawn';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** The process could not be started at all. */
  failed?: boolean;
}

export type Runner = (
  file: string,
  args: readonly string[],
  opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
) => Promise<RunResult>;

const OUTPUT_CAP = 1024 * 1024;

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const hit = Object.keys(env).find((k) => k.toUpperCase() === key);
  return hit === undefined ? undefined : env[hit];
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Finds an executable on PATH, then in `extraDirs`. On Windows a real `.exe` wins over a `.cmd` shim in the same
 * folder, because Node cannot start shims without a shell.
 */
export function which(
  name: string,
  extraDirs: readonly string[] = [],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const dirs = [...(envValue(env, 'PATH') ?? '').split(platform === 'win32' ? ';' : delimiter), ...extraDirs]
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
  let exts = [''];
  if (platform === 'win32') {
    const allowed = (envValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').toLowerCase().split(';');
    exts = ['.exe', '.cmd', '.bat', '.com'].filter((e) => allowed.includes(e));
  }
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

export interface Launch {
  file: string;
  args: string[];
  /** Set when a Node script is run with Electron's own Node (`ELECTRON_RUN_AS_NODE`). */
  env?: Record<string, string>;
}

/**
 * How to start an executable without a shell. npm's Windows shims (`claude.cmd`) cannot be spawned directly:
 * they are read for the real target, an `.exe` started as is or a JS file started with Node.
 */
export function resolveLaunch(path: string, nodePath: string | undefined = which('node')): Launch {
  if (!/\.(cmd|bat)$/i.test(path)) return { file: path, args: [] };
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { file: path, args: [] };
  }
  const targets = [...text.matchAll(/"%~?dp0%?\\?([^"%]+)"/gi)].map((m) => m[1] ?? '');
  const target = targets.at(-1);
  if (!target) return { file: path, args: [] };
  const full = join(dirname(path), target);
  if (/\.exe$/i.test(full)) return { file: full, args: [] };
  if (/\.(c|m)?js$/i.test(full)) {
    if (nodePath) return { file: nodePath, args: [full] };
    return { file: process.execPath, args: [full], env: { ELECTRON_RUN_AS_NODE: '1' } };
  }
  return { file: path, args: [] };
}

export function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    nodeSpawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on(
      'error',
      () => {},
    );
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

/** Runs a program with fixed arguments (never user text) and collects its output. */
export const run: Runner = (file, args, opts = {}) =>
  new Promise((resolve) => {
    const timeoutMs = opts.timeoutMs ?? 10_000;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const done = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(file, [...args], {
      env: opts.env ?? process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
      done({ code: null, stdout, stderr, timedOut });
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < OUTPUT_CAP) stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < OUTPUT_CAP) stderr += chunk.toString('utf8');
    });
    child.on('error', () => done({ code: null, stdout, stderr, timedOut, failed: true }));
    child.on('close', (code) => done({ code, stdout, stderr, timedOut }));
  });

/** Opens a console window that runs `file args` and stays open, for a CLI's own interactive login. */
export function openConsole(
  file: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  /** Extra variables for the CLI (an account's config folder). */
  env?: Record<string, string>,
): boolean {
  const start = (cmd: string, cmdArgs: string[]): boolean => {
    try {
      const child = nodeSpawn(cmd, cmdArgs, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        ...(env ? { env: { ...process.env, ...env } } : {}),
      });
      child.on('error', () => {});
      child.unref();
      return true;
    } catch {
      return false;
    }
  };
  if (platform === 'win32') {
    // A detached console program gets its own window; `/k` keeps it open after the login finishes.
    return start('cmd.exe', ['/k', file, ...args]);
  }
  const terminals: [string, string[]][] = [
    ['x-terminal-emulator', ['-e', file, ...args]],
    ['gnome-terminal', ['--', file, ...args]],
    ['konsole', ['-e', file, ...args]],
    ['xfce4-terminal', ['-x', file, ...args]],
    ['kitty', [file, ...args]],
    ['alacritty', ['-e', file, ...args]],
    ['xterm', ['-e', file, ...args]],
  ];
  for (const [term, termArgs] of terminals) {
    const path = which(term, [], process.env, platform);
    if (path) return start(path, termArgs);
  }
  return false;
}
