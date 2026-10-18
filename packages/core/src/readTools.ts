// Advisors' read-only tools (PLAN.md 5.4): they look at the project folder, never change it. Every path stays
// inside the folder (symlinks included); git runs with fixed arguments only. Results are capped and marked as data.
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { LlmCall, LlmTool } from '@lonca/protocol';
import type { Runner } from './proc.js';

const SKIP = new Set(['.git', 'node_modules', '.venv', 'dist', 'out', 'build', '.next', 'target']);
const MAX_RESULT = 8000;

export const READ_TOOLS: LlmTool[] = [
  {
    name: 'list_files',
    description: 'Lists the files and folders in a folder of the project (relative path, default the project root).',
    parameters: { type: 'object', properties: { path: { type: 'string' } } },
  },
  {
    name: 'read_file',
    description: 'Reads a text file of the project, with line numbers. Long files: ask for a range of lines.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, from_line: { type: 'number' }, to_line: { type: 'number' } },
      required: ['path'],
    },
  },
  {
    name: 'search',
    description: 'Finds lines that contain a text in the project files (case-insensitive).',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'git_log',
    description: 'Recent commits of the project, newest first, optionally only those touching a path.',
    parameters: { type: 'object', properties: { count: { type: 'number' }, path: { type: 'string' } } },
  },
  {
    name: 'git_show',
    description: 'One commit: its message, the files it changed and the diff (shortened when long).',
    parameters: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] },
  },
];

class ToolRefusal extends Error {}

/** A path inside the folder, or a refusal. Symlinks are followed before the check. */
function inside(root: string, rel: unknown): string {
  const realRoot = realpathSync(root);
  const raw = typeof rel === 'string' && rel.trim() ? rel.trim() : '.';
  const target = isAbsolute(raw) ? raw : resolve(realRoot, raw);
  let real: string;
  try {
    real = realpathSync(target);
  } catch {
    throw new ToolRefusal(`not found: ${raw}`);
  }
  if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new ToolRefusal(`outside the project: ${raw}`);
  return real;
}

const cap = (text: string, max = MAX_RESULT) => (text.length > max ? `${text.slice(0, max)}\n… (shortened)` : text);

function listFiles(root: string, path: unknown): string {
  const dir = inside(root, path);
  if (!statSync(dir).isDirectory()) throw new ToolRefusal('not a folder');
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => !SKIP.has(e.name))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, 300)
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  return entries.length ? entries.join('\n') : '(empty)';
}

function readText(file: string): string {
  const st = statSync(file);
  if (!st.isFile()) throw new ToolRefusal('not a file');
  if (st.size > 2 * 1024 * 1024) throw new ToolRefusal('file too large');
  const text = readFileSync(file, 'utf8');
  if (text.includes('\u0000')) throw new ToolRefusal('binary file');
  return text;
}

function readFile(root: string, args: Record<string, unknown>): string {
  const file = inside(root, args.path);
  const lines = readText(file).split('\n');
  const from = Math.max(1, Math.floor(Number(args.from_line) || 1));
  const to = Math.min(lines.length, Math.floor(Number(args.to_line) || from + 399));
  const body = lines
    .slice(from - 1, to)
    .map((l, i) => `${from + i}\t${l}`)
    .join('\n');
  const more = to < lines.length ? `\n(lines ${from}-${to} of ${lines.length})` : '';
  return cap(body + more, 30_000);
}

function walk(root: string, visit: (file: string) => boolean): void {
  const stack = [root];
  let seen = 0;
  while (stack.length) {
    const dir = stack.pop() as string;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name) || e.isSymbolicLink()) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        seen += 1;
        if (seen > 3000 || !visit(p)) return;
      }
    }
  }
}

async function search(root: string, text: unknown, runner: Runner): Promise<string> {
  const query = typeof text === 'string' ? text.trim().slice(0, 200) : '';
  if (!query) throw new ToolRefusal('empty search');
  const git = await runner('git', ['-C', root, 'grep', '-n', '-I', '-i', '-F', '--max-count=5', '-e', query], {
    timeoutMs: 15_000,
  });
  if (!git.failed && (git.code === 0 || git.code === 1) && !/not a git repository/i.test(git.stderr)) {
    return git.code === 1 ? 'No matches.' : cap(git.stdout.trim());
  }
  // Not a repository: a plain walk with limits.
  const hits: string[] = [];
  const needle = query.toLowerCase();
  walk(realpathSync(root), (file) => {
    try {
      const lines = readText(file).split('\n');
      lines.forEach((l, i) => {
        if (hits.length < 60 && l.toLowerCase().includes(needle)) {
          hits.push(`${relative(root, file).split(sep).join('/')}:${i + 1}:${l.slice(0, 200)}`);
        }
      });
    } catch {
      // unreadable or binary: skipped
    }
    return hits.length < 60;
  });
  return hits.length ? hits.join('\n') : 'No matches.';
}

async function gitLog(root: string, args: Record<string, unknown>, runner: Runner): Promise<string> {
  const count = Math.min(30, Math.max(1, Math.floor(Number(args.count) || 15)));
  const path = typeof args.path === 'string' && args.path.trim() ? inside(root, args.path) : undefined;
  const r = await runner(
    'git',
    ['-C', root, 'log', `-n${count}`, '--date=short', '--pretty=format:%h %ad %an: %s', ...(path ? ['--', path] : [])],
    { timeoutMs: 15_000 },
  );
  if (r.failed || r.code !== 0) throw new ToolRefusal('not a git repository');
  return cap(r.stdout.trim() || 'No commits.');
}

async function gitShow(root: string, ref: unknown, runner: Runner): Promise<string> {
  const value = typeof ref === 'string' ? ref.trim() : '';
  // A commit-ish only: no options, no paths, no ranges that read outside history.
  if (!/^[\w./~^@{}-]{1,80}$/.test(value) || value.startsWith('-')) throw new ToolRefusal('bad ref');
  const r = await runner('git', ['-C', root, 'show', '--stat', '--patch', '--no-color', '--no-ext-diff', value, '--'], {
    timeoutMs: 15_000,
  });
  if (r.failed || r.code !== 0) throw new ToolRefusal(`unknown ref: ${value}`);
  return cap(r.stdout, 12_000);
}

/** Runs one tool call in the folder; a refusal comes back as the tool's text, so the model can go on. */
export async function runReadTool(root: string, call: LlmCall, runner: Runner): Promise<string> {
  try {
    switch (call.name) {
      case 'list_files':
        return listFiles(root, call.args.path);
      case 'read_file':
        return readFile(root, call.args);
      case 'search':
        return await search(root, call.args.text, runner);
      case 'git_log':
        return await gitLog(root, call.args, runner);
      case 'git_show':
        return await gitShow(root, call.args.ref, runner);
      default:
        return `Unknown tool: ${call.name}`;
    }
  } catch (e) {
    return e instanceof ToolRefusal
      ? `Refused: ${e.message}`
      : `Failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`;
  }
}
