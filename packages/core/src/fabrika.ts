// Moving from Fabrika (roblox-factory's cockpit app) to Serai: reads a Fabrika repository's ideas (`ideas/*.md`),
// references (`references/*.json` with their images), saved prompts (`.claude/commands/*.md`) and games with a
// status page (`games/*/progress.md`), and returns them in Serai's shapes. Nothing in the folder is changed.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { IdeaStatus } from '@lonca/protocol';

export interface FabrikaIdea {
  title: string;
  body: string;
  tags: string[];
  status: IdeaStatus;
}

export interface FabrikaReference {
  title: string;
  body: string;
  tags: string[];
  imageData: string;
}

export interface FabrikaCommand {
  title: string;
  body: string;
}

export interface FabrikaGame {
  name: string;
  folder: string;
}

export interface FabrikaContent {
  ideas: FabrikaIdea[];
  references: FabrikaReference[];
  commands: FabrikaCommand[];
  games: FabrikaGame[];
}

const STATUS: Record<string, IdeaStatus> = {
  new: 'new',
  planned: 'later',
  later: 'later',
  doing: 'doing',
  done: 'done',
  dropped: 'dropped',
};

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_TEXT = 20_000;

/** `---` front matter with `key: value` lines (a `[a, b]` value is a list), and the text after it. */
export function frontMatter(text: string): { meta: Record<string, string | string[]>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string | string[]> = {};
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (!kv?.[1]) continue;
    const value = kv[2] ?? '';
    const list = /^\[(.*)\]$/.exec(value);
    meta[kv[1]] = list
      ? (list[1] ?? '')
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)
      : value.replace(/^["']|["']$/g, '');
  }
  return { meta, body: m[2] ?? '' };
}

const files = (dir: string, ext: string) => {
  try {
    return readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(ext))
      .sort();
  } catch {
    return [];
  }
};

const read = (file: string) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
};

/** Whether a folder looks like a Fabrika repository (any of the parts Serai can take over). */
export function isFabrika(folder: string): boolean {
  return ['ideas', 'references', join('.claude', 'commands'), 'games'].some((p) => existsSync(join(folder, p)));
}

export function readFabrika(folder: string): FabrikaContent {
  const ideas: FabrikaIdea[] = [];
  for (const f of files(join(folder, 'ideas'), '.md')) {
    if (f.toLowerCase() === 'readme.md') continue;
    const text = read(join(folder, 'ideas', f));
    if (!text) continue;
    const { meta, body } = frontMatter(text);
    const title =
      (typeof meta.title === 'string' && meta.title) || f.replace(/^\d{8}-\d{6}-/, '').replace(/\.md$/i, '');
    const tags = [
      ...(Array.isArray(meta.tags) ? meta.tags : []),
      ...(typeof meta.kind === 'string' && meta.kind ? [meta.kind] : []),
    ];
    ideas.push({
      title: title.slice(0, 200),
      body: body.trim().slice(0, MAX_TEXT),
      tags: [...new Set(tags.map((t) => t.toLowerCase()))].slice(0, 12),
      status: STATUS[String(meta.status ?? '').toLowerCase()] ?? 'new',
    });
  }

  const references: FabrikaReference[] = [];
  for (const f of files(join(folder, 'references'), '.json')) {
    const raw = read(join(folder, 'references', f));
    if (!raw) continue;
    let data: { title?: unknown; source?: unknown; tags?: unknown; note?: unknown; file?: unknown };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      continue;
    }
    const image = typeof data.file === 'string' ? join(folder, 'references', data.file) : '';
    const mime = MIME[extname(image).toLowerCase()];
    if (!image || !mime || !existsSync(image) || statSync(image).size > MAX_IMAGE) continue;
    const note = [typeof data.note === 'string' ? data.note : '', typeof data.source === 'string' ? data.source : '']
      .filter(Boolean)
      .join('\n\n');
    references.push({
      title: (typeof data.title === 'string' && data.title ? data.title : f.replace(/\.json$/i, '')).slice(0, 200),
      body: note.slice(0, MAX_TEXT),
      tags: (Array.isArray(data.tags) ? data.tags : []).filter((t): t is string => typeof t === 'string').slice(0, 12),
      imageData: `data:${mime};base64,${readFileSync(image).toString('base64')}`,
    });
  }

  const commands: FabrikaCommand[] = [];
  for (const f of files(join(folder, '.claude', 'commands'), '.md')) {
    const text = read(join(folder, '.claude', 'commands', f));
    if (!text?.trim()) continue;
    const { body } = frontMatter(text);
    commands.push({ title: f.replace(/\.md$/i, '').slice(0, 200), body: body.trim().slice(0, MAX_TEXT) });
  }

  const games: FabrikaGame[] = [];
  let dirs: string[] = [];
  try {
    dirs = readdirSync(join(folder, 'games')).sort();
  } catch {
    // no games
  }
  for (const d of dirs) {
    const dir = join(folder, 'games', d);
    if (!existsSync(join(dir, 'progress.md'))) continue;
    const heading = /^#\s+(.+?)\s*$/m.exec(read(join(dir, 'README.md')) ?? '')?.[1];
    games.push({ name: (heading ?? d).replace(/\s+—.*$/, '').slice(0, 60), folder: dir });
  }
  return { ideas, references, commands, games };
}
