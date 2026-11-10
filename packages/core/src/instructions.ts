// Editable instruction layers (PLAN.md 5.14), kept as Markdown files people can open:
//   <data>/instructions/worker.md            the worker template (layer 2), with the default it started from
//   <workspace>/instructions.md               the workspace's instructions (layer 3)
// Every save keeps the previous text under history/. Serai's core rules (layer 1) stay in code: they describe
// what Serai enforces, so a text edit could not change them anyway.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORKER_TEMPLATE } from './prompts.js';

const HISTORY_KEEP = 20;

export interface Layer {
  text: string;
  /** The text is the shipped default. */
  isDefault: boolean;
  /** The shipped default changed since this text was edited from it. */
  defaultChanged: boolean;
  default: string;
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

function read(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** `<!-- lonca base=<hash> -->` on the first line records which default an edited file started from. */
function parse(raw: string): { base?: string; text: string } {
  const m = /^<!-- lonca base=([a-f0-9]{16}) -->\r?\n/.exec(raw);
  return m ? { base: m[1], text: raw.slice(m[0].length) } : { text: raw };
}

export class Instructions {
  constructor(
    private readonly dataDir: string,
    private readonly workspaceDir: string,
  ) {}

  private workerFile(): string {
    return join(this.dataDir, 'instructions', 'worker.md');
  }

  private workspaceFile(): string {
    return join(this.workspaceDir, 'instructions.md');
  }

  worker(): Layer {
    const raw = read(this.workerFile());
    if (raw === undefined)
      return { text: WORKER_TEMPLATE, isDefault: true, defaultChanged: false, default: WORKER_TEMPLATE };
    const { base, text } = parse(raw);
    return {
      text,
      isDefault: text === WORKER_TEMPLATE,
      defaultChanged: base !== undefined && base !== hash(WORKER_TEMPLATE) && text !== WORKER_TEMPLATE,
      default: WORKER_TEMPLATE,
    };
  }

  workspace(): string {
    return read(this.workspaceFile()) ?? '';
  }

  private keep(file: string): void {
    const previous = read(file);
    if (previous === undefined) return;
    const dir = join(file, '..', 'history');
    mkdirSync(dir, { recursive: true });
    const name = `${file.split(/[\\/]/).pop()?.replace(/\.md$/, '')}-${Date.now()}.md`;
    writeFileSync(join(dir, name), previous);
    const old = readdirSync(dir)
      .filter((n) => n.startsWith(name.replace(/-\d+\.md$/, '-')))
      .sort();
    for (const n of old.slice(0, Math.max(0, old.length - HISTORY_KEEP))) rmSync(join(dir, n), { force: true });
  }

  saveWorker(text: string): Layer {
    const file = this.workerFile();
    mkdirSync(join(file, '..'), { recursive: true });
    this.keep(file);
    if (text.trim() === WORKER_TEMPLATE.trim()) rmSync(file, { force: true });
    else writeFileSync(file, `<!-- lonca base=${hash(WORKER_TEMPLATE)} -->\n${text}`);
    return this.worker();
  }

  resetWorker(): Layer {
    this.keep(this.workerFile());
    rmSync(this.workerFile(), { force: true });
    return this.worker();
  }

  saveWorkspace(text: string): string {
    const file = this.workspaceFile();
    mkdirSync(join(file, '..'), { recursive: true });
    this.keep(file);
    writeFileSync(file, text);
    return this.workspace();
  }
}
