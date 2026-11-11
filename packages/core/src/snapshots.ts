// What a job changed, and taking it back (PLAN.md 5.3). Before a job starts and after it ends, the agent's folder
// is written into the repository as a tree, through an index of its own so the person's index and working tree are
// never touched; each tree is kept as a commit under `refs/<slug>/jobs/<job>/before|after` (refs git never pushes
// or shows by itself). The difference of the two is what the job changed; a file is taken back by writing its
// `before` content again, only while it still is as the job left it. Folders outside a git repository have none
// of this.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { BRAND, CoreError, type JobChanges, type JobFileChange } from '@lonca/protocol';
import type { Runner } from './proc.js';

/** What is kept on this computer about a job's snapshots; the trees themselves are in the repository. */
interface Kept {
  /** The repository's top folder. */
  root: string;
  /** The agent's folder inside it, with a trailing slash; empty for the top folder itself. */
  prefix: string;
  before: string;
  after?: string;
}

const REFS = `refs/${BRAND.slug}/jobs`;
/** Jobs whose snapshots a repository keeps; older ones are let go (git removes their objects in time). */
const KEEP = 40;
/** A folder with more new files than this is not snapshotted: it is not kept by git in any useful sense. */
const MAX_UNTRACKED = 5000;
const MAX_FILES = 300;
const MAX_PATCH = 200_000;
const JOB_ID = /^[\w-]{1,64}$/;

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export class Snapshots {
  constructor(
    private readonly runner: Runner,
    /** Where the records and the temporary index files go (the workspace's `jobs` folder). */
    private readonly dir: string,
  ) {}

  private git(root: string, args: string[], opts: { index?: string; timeoutMs?: number } = {}) {
    // No optional locks: a status here must never be in the way of a commit the person or a goal makes meanwhile.
    return this.runner('git', ['--no-optional-locks', '-C', root, '-c', 'core.quotepath=off', ...args], {
      timeoutMs: opts.timeoutMs ?? 20_000,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C',
        GIT_AUTHOR_NAME: BRAND.name,
        GIT_AUTHOR_EMAIL: `${BRAND.slug}@localhost`,
        GIT_COMMITTER_NAME: BRAND.name,
        GIT_COMMITTER_EMAIL: `${BRAND.slug}@localhost`,
        ...(opts.index ? { GIT_INDEX_FILE: opts.index } : {}),
      },
    });
  }

  private async out(root: string, args: string[], opts: { index?: string; timeoutMs?: number } = {}) {
    const r = await this.git(root, args, opts);
    return r.failed || r.timedOut || r.code !== 0 ? undefined : r.stdout;
  }

  private file(jobId: string): string {
    return join(this.dir, `${jobId}.snap.json`);
  }

  private read(jobId: string): Kept | undefined {
    if (!JOB_ID.test(jobId)) return undefined;
    try {
      const r = JSON.parse(readFileSync(this.file(jobId), 'utf8')) as Kept;
      return typeof r.root === 'string' && typeof r.before === 'string' ? r : undefined;
    } catch {
      return undefined;
    }
  }

  /** The folder as a commit, without touching the person's index: undefined when it cannot be taken. */
  private async take(root: string, prefix: string, jobId: string, which: 'before' | 'after', gitIndex?: string) {
    const real = gitIndex ?? (await this.out(root, ['rev-parse', '--git-path', 'index']));
    if (real === undefined) return undefined;
    const index = join(this.dir, `${jobId}.${which}.index`);
    try {
      mkdirSync(this.dir, { recursive: true });
      const source = isAbsolute(real.trim()) ? real.trim() : resolve(root, real.trim());
      // Starting from the person's index, only what changed since has to be read again.
      if (existsSync(source)) copyFileSync(source, index);
      const where = prefix || '.';
      const status = await this.git(root, ['status', '--porcelain', '-uall', '--', where], { timeoutMs: 30_000 });
      if (status.failed || status.timedOut || status.code !== 0) return undefined;
      if (status.stdout.split('\n').filter((l) => l.startsWith('??')).length > MAX_UNTRACKED) return undefined;
      if ((await this.out(root, ['add', '-A', '--', where], { index, timeoutMs: 60_000 })) === undefined)
        return undefined;
      const tree = (await this.out(root, ['write-tree'], { index }))?.trim();
      if (!tree) return undefined;
      const commit = (await this.out(root, ['commit-tree', tree, '-m', `${BRAND.slug} job ${jobId} ${which}`]))?.trim();
      if (!commit) return undefined;
      if ((await this.out(root, ['update-ref', `${REFS}/${jobId}/${which}`, commit])) === undefined) return undefined;
      return commit;
    } catch {
      return undefined;
    } finally {
      rmSync(index, { force: true });
      rmSync(`${index}.lock`, { force: true });
    }
  }

  /** Before the job's first step: remembers the folder as it is. Quietly does nothing outside a repository. */
  async before(jobId: string, folder: string): Promise<void> {
    if (!JOB_ID.test(jobId)) return;
    // One call for the three things: the top folder, this folder inside it, and where the index is (as seen
    // from this folder).
    const where = await this.out(folder, ['rev-parse', '--show-toplevel', '--show-prefix', '--git-path', 'index']);
    const [top, inside, gitIndex] = (where ?? '').split('\n').map((l) => l.trim());
    if (!top || !gitIndex || !isDir(top)) return;
    const root = resolve(top);
    const prefix = inside ?? '';
    const before = await this.take(
      root,
      prefix,
      jobId,
      'before',
      isAbsolute(gitIndex) ? gitIndex : resolve(folder, gitIndex),
    );
    if (!before) return;
    const record: Kept = { root, prefix, before };
    writeFileSync(this.file(jobId), JSON.stringify(record));
    void this.prune(root).catch(() => {});
  }

  /** After the job: what it changed in its folder. Undefined when nothing did, or there was no snapshot. */
  async after(jobId: string): Promise<JobChanges | undefined> {
    const record = this.read(jobId);
    if (!record || !isDir(record.root)) return undefined;
    const after = await this.take(record.root, record.prefix, jobId, 'after');
    if (!after) return undefined;
    writeFileSync(this.file(jobId), JSON.stringify({ ...record, after }));
    const where = record.prefix || '.';
    const range = [record.before, after, '--', where];
    const names = await this.out(record.root, ['diff', '--name-status', '--no-renames', '-z', ...range]);
    const stats = await this.out(record.root, ['diff', '--numstat', '--no-renames', '-z', ...range]);
    if (names === undefined || stats === undefined) return undefined;
    const counts = new Map<string, { added: number; removed: number; binary: boolean }>();
    for (const entry of stats.split('\0')) {
      const m = /^(-|\d+)\t(-|\d+)\t([\s\S]+)$/.exec(entry);
      if (m?.[3]) counts.set(m[3], { added: Number(m[1]) || 0, removed: Number(m[2]) || 0, binary: m[1] === '-' });
    }
    const parts = names.split('\0');
    const files: JobFileChange[] = [];
    let total = 0;
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const path = parts[i + 1] ?? '';
      const letter = parts[i]?.[0];
      if (!path || !letter) continue;
      total += 1;
      if (files.length >= MAX_FILES) continue;
      const c = counts.get(path);
      files.push({
        path,
        status: letter === 'A' ? 'added' : letter === 'D' ? 'deleted' : 'modified',
        added: c?.added ?? 0,
        removed: c?.removed ?? 0,
        ...(c?.binary ? { binary: true as const } : {}),
      });
    }
    if (total === 0) {
      // Nothing changed: nothing to keep in the repository.
      await this.forget(jobId, record.root);
      return undefined;
    }
    return { files, ...(total > files.length ? { more: total - files.length } : {}) };
  }

  private async forget(jobId: string, root: string): Promise<void> {
    for (const which of ['before', 'after']) await this.git(root, ['update-ref', '-d', `${REFS}/${jobId}/${which}`]);
    rmSync(this.file(jobId), { force: true });
  }

  /** Lets go of the snapshots of all but the latest jobs in a repository. */
  private async prune(root: string): Promise<void> {
    const refs = await this.out(root, ['for-each-ref', '--sort=-creatordate', '--format=%(refname)', REFS]);
    if (refs === undefined) return;
    const jobs: string[] = [];
    for (const ref of refs.split('\n')) {
      const id = ref.slice(REFS.length + 1).split('/')[0];
      if (id && !jobs.includes(id)) jobs.push(id);
    }
    for (const id of jobs.slice(KEEP)) {
      for (const which of ['before', 'after']) await this.git(root, ['update-ref', '-d', `${REFS}/${id}/${which}`]);
    }
  }

  /** A record whose snapshots are still in the repository. */
  private async kept(jobId: string): Promise<Required<Kept>> {
    const record = this.read(jobId);
    if (!record?.after || !isDir(record.root)) throw new CoreError('no_snapshot');
    for (const commit of [record.before, record.after]) {
      if ((await this.out(record.root, ['cat-file', '-e', `${commit}^{commit}`])) === undefined)
        throw new CoreError('no_snapshot');
    }
    return { ...record, after: record.after };
  }

  /** One file's change as a unified diff. */
  async diff(jobId: string, path: string): Promise<{ patch: string; truncated?: true }> {
    const record = await this.kept(jobId);
    const patch = await this.out(record.root, [
      'diff',
      '--no-color',
      '--no-renames',
      '--no-ext-diff',
      '-U3',
      record.before,
      record.after,
      '--',
      path,
    ]);
    if (patch === undefined) throw new CoreError('no_snapshot');
    // The header lines (diff, index, ---, +++) say nothing the card does not show already.
    const at = patch.indexOf('\n@@');
    const body = at >= 0 ? patch.slice(at + 1) : '';
    return body.length > MAX_PATCH ? { patch: body.slice(0, MAX_PATCH), truncated: true } : { patch: body };
  }

  /**
   * Takes files back to what they were before the job. A file is left alone (`skipped`) when it no longer is as
   * the job left it: someone, or a later job, has worked on it since.
   */
  async undo(jobId: string, files: JobFileChange[]): Promise<{ undone: string[]; skipped: string[] }> {
    const record = await this.kept(jobId);
    const undone: string[] = [];
    const skipped: string[] = [];
    for (const f of files) {
      const full = join(record.root, f.path);
      const here = existsSync(full);
      let same: boolean;
      if (f.status === 'deleted') same = !here;
      else {
        const left = (
          await this.out(record.root, ['rev-parse', '--verify', '--quiet', `${record.after}:${f.path}`])
        )?.trim();
        const now = here ? (await this.out(record.root, ['hash-object', '--', f.path]))?.trim() : undefined;
        same = Boolean(left) && left === now;
      }
      if (!same) {
        skipped.push(f.path);
        continue;
      }
      let ok: boolean;
      if (f.status === 'added') {
        try {
          unlinkSync(full);
          ok = true;
        } catch {
          ok = false;
        }
      } else {
        // Where git turns line endings into CRLF on the way out (autocrlf), a file the folder holds with plain
        // LF endings would come back changed: such a file is written as it is stored.
        const plain = f.status === 'modified' && !f.binary && !readFileSync(full).includes('\r\n');
        const args = [
          ...(plain ? ['-c', 'core.autocrlf=false'] : []),
          'restore',
          `--source=${record.before}`,
          '--worktree',
          '--',
          f.path,
        ];
        ok = (await this.out(record.root, args)) !== undefined;
      }
      (ok ? undone : skipped).push(f.path);
    }
    return { undone, skipped };
  }
}
