// Several logins per CLI on one computer (Fabrika's second worker on another Claude login, made general): an account
// is a config folder of the CLI's own that Lonca points it at (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`). The CLI signs in
// there with its own login command and keeps its own files; Lonca never reads, copies or moves them (principle 5).
// Accounts belong to this computer: they are kept in `<app>/accounts.json`, never in a workspace.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CliKind } from '@lonca/protocol';
import { newId } from './ids.js';

/** The variable that moves each CLI's config (and so its login) to another folder. */
export const ACCOUNT_ENV: Partial<Record<CliKind, string>> = {
  'claude-code': 'CLAUDE_CONFIG_DIR',
  codex: 'CODEX_HOME',
};

export interface AccountEntry {
  id: string;
  kind: CliKind;
  name: string;
  created: number;
}

export class Accounts {
  constructor(
    private readonly file: string,
    private readonly root: string,
  ) {}

  list(): AccountEntry[] {
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as { accounts?: unknown };
      return Array.isArray(data.accounts)
        ? (data.accounts as AccountEntry[]).filter(
            (a) => typeof a?.id === 'string' && /^[\w-]{4,64}$/.test(a.id) && ACCOUNT_ENV[a.kind] !== undefined,
          )
        : [];
    } catch {
      return [];
    }
  }

  get(id: string): AccountEntry | undefined {
    return this.list().find((a) => a.id === id);
  }

  /** The folder the CLI keeps this account's config and login in. */
  folder(id: string): string {
    return join(this.root, id);
  }

  add(kind: CliKind, name: string): AccountEntry {
    const entry: AccountEntry = { id: newId(), kind, name, created: Date.now() };
    mkdirSync(this.folder(entry.id), { recursive: true });
    this.write([...this.list(), entry]);
    return entry;
  }

  /** Forgets the account. Its folder stays: the CLI's own files are not Lonca's to delete. */
  remove(id: string): void {
    this.write(this.list().filter((a) => a.id !== id));
  }

  /** The environment that points the CLI at the account. */
  env(id: string | undefined): Record<string, string> | undefined {
    const entry = id ? this.get(id) : undefined;
    const name = entry ? ACCOUNT_ENV[entry.kind] : undefined;
    return entry && name ? { [name]: this.folder(entry.id) } : undefined;
  }

  private write(list: AccountEntry[]): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify({ accounts: list }, null, 1));
    renameSync(`${this.file}.tmp`, this.file);
  }
}
