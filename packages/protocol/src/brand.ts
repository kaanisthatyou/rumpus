// The product's name, in one place. Everything a person or a model reads takes it from here (the UI through the
// `{{app}}` variable of the locale files). The code name `lonca` stays in package names, environment variables,
// wire headers and file names, so a new name is a change to this file, the icon and the installer config.
export const BRAND = {
  name: 'Rumpus',
  /** Lowercase, for identifiers people see: the MCP server agents call, git branch prefixes, link schemes. */
  slug: 'rumpus',
  appId: 'io.github.kaanisthatyou.rumpus',
  repo: 'https://github.com/kaanisthatyou/rumpus',
  /**
   * The names the product had before, latest first (Serai until 2026-11-11, Lonca until 2026-11-10); their data
   * folders, invite codes and links are still accepted.
   */
  formers: [
    { name: 'Serai', slug: 'serai' },
    { name: 'Lonca', slug: 'lonca' },
  ],
} as const;

/** The product's slug and the ones it had before. */
const SLUGS = [BRAND.slug, ...BRAND.formers.map((f) => f.slug)];

/**
 * What people type after `@` for a name: lowercase ASCII letters, digits and dashes ("Doğrucu Davut" →
 * `dogrucu-davut`). Agents' and advisors' handles are made with it, and a member is mentioned by it.
 */
export function handleOf(name: string): string {
  return name
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

/** The MCP server name agents see the workspace's tools under (`mcp__rumpus__add_card`). */
export const MCP_NAME = BRAND.slug;

const INVITE_PREFIXES = SLUGS.map((s) => `${s.toUpperCase()}1.`);
const LINK = new RegExp(`^(?:${SLUGS.join('|')})://join/?\\??(?:code=)?`, 'i');

/** What an invite code starts with (`RUMPUS1.`), for the hint next to the field it is pasted into. */
export const INVITE_PREFIX = INVITE_PREFIXES[0] as string;

/** An invite code as it is handed out: `RUMPUS1.<payload>`. */
export function inviteCode(payload: string): string {
  return `${INVITE_PREFIX}${payload}`;
}

/** The same code as a link the app opens (`rumpus://join/RUMPUS1...`), for chats that make links clickable. */
export function inviteLink(code: string): string {
  return `${BRAND.slug}://join/${code}`;
}

/** What a friend code starts with (`RUMPUSF1.`), for the box it is pasted into. */
export const FRIEND_PREFIX = `${BRAND.slug.toUpperCase()}F1.`;

/** A friend code as it is handed out: `RUMPUSF1.<payload>`. It names a person's computer; it is not a secret. */
export function friendCode(payload: string): string {
  return `${FRIEND_PREFIX}${payload}`;
}

/** The payload of a pasted friend code; undefined when it is none. */
export function friendPayload(pasted: string): string | undefined {
  const raw = pasted.trim();
  if (!raw.toUpperCase().startsWith(FRIEND_PREFIX)) return undefined;
  const payload = raw.slice(FRIEND_PREFIX.length);
  return /^[\w-]+$/.test(payload) ? payload : undefined;
}

const INVITE_IN_TEXT = new RegExp(
  `(?:(?:${SLUGS.join('|')})://join/)?(?:${SLUGS.map((s) => s.toUpperCase()).join('|')})1\\.[A-Za-z0-9_-]{40,}`,
  'gi',
);

/**
 * The invites written in a message, as they stand in it (a code or a link), in order; one invite written twice
 * (its code and its link) counts once. At most three.
 */
export function findInvites(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const found of text.match(INVITE_IN_TEXT) ?? []) {
    const payload = invitePayload(found);
    if (!payload || seen.has(payload)) continue;
    seen.add(payload);
    out.push(found);
  }
  return out.slice(0, 3);
}

/**
 * The payload of what a person pasted: a code, a code or a link from under a former name, or an invite link.
 * Undefined when it is none of them.
 */
export function invitePayload(pasted: string): string | undefined {
  const raw = pasted.trim().replace(LINK, '').replace(/\/+$/, '');
  const prefix = INVITE_PREFIXES.find((p) => raw.toUpperCase().startsWith(p));
  if (!prefix) return undefined;
  const payload = raw.slice(prefix.length);
  return /^[\w-]+$/.test(payload) ? payload : undefined;
}
