// The product's name, in one place. Everything a person or a model reads takes it from here (the UI through the
// `{{app}}` variable of the locale files). The code name `lonca` stays in package names, environment variables,
// wire headers and file names, so a new name is a change to this file, the icon and the installer config.
export const BRAND = {
  name: 'Serai',
  /** Lowercase, for identifiers people see: the MCP server agents call, git branch prefixes, link schemes. */
  slug: 'serai',
  appId: 'io.github.kaanisthatyou.serai',
  repo: 'https://github.com/kaanisthatyou/lonca',
  /** The name the product had before; its data folder and invite codes are still accepted. */
  former: { name: 'Lonca', slug: 'lonca' },
} as const;

/** The MCP server name agents see the workspace's tools under (`mcp__serai__add_card`). */
export const MCP_NAME = BRAND.slug;

const INVITE_PREFIXES = [`${BRAND.slug.toUpperCase()}1.`, `${BRAND.former.slug.toUpperCase()}1.`] as const;
const LINK = new RegExp(`^${BRAND.slug}://join/?\\??(?:code=)?`, 'i');

/** An invite code as it is handed out: `SERAI1.<payload>`. */
export function inviteCode(payload: string): string {
  return `${INVITE_PREFIXES[0]}${payload}`;
}

/** The same code as a link the app opens (`serai://join/SERAI1...`), for chats that make links clickable. */
export function inviteLink(code: string): string {
  return `${BRAND.slug}://join/${code}`;
}

/**
 * The payload of what a person pasted: a code, a code from before the rename, or an invite link. Undefined when it
 * is none of them.
 */
export function invitePayload(pasted: string): string | undefined {
  const raw = pasted.trim().replace(LINK, '').replace(/\/+$/, '');
  const prefix = INVITE_PREFIXES.find((p) => raw.toUpperCase().startsWith(p));
  if (!prefix) return undefined;
  const payload = raw.slice(prefix.length);
  return /^[\w-]+$/.test(payload) ? payload : undefined;
}
