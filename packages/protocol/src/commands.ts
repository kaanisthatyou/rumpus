// The slash commands of the message box, in one place: the name each is offered under in each language, and
// every name it answers to. A command answers to all of its names whatever the app's language is, so a Turkish
// and an English speaker in one workspace can read each other's messages and type what they are used to.

export const COMMANDS = {
  todo: { tr: '/todo', en: '/todo' },
  goal: { tr: '/goal', en: '/goal' },
  race: { tr: '/yarış', en: '/race', also: ['/yaris'] },
  remember: { tr: '/hatırla', en: '/remember', also: ['/hatirla'] },
  council: { tr: '/meclis', en: '/council' },
  digest: { tr: '/özet', en: '/summary', also: ['/ozet'] },
  status: { tr: '/durum', en: '/status' },
  newSession: { tr: '/yeni-oturum', en: '/new-session' },
} as const satisfies Record<string, { tr: string; en: string; also?: readonly string[] }>;

export type CommandKey = keyof typeof COMMANDS;

export const COMMAND_KEYS = Object.keys(COMMANDS) as CommandKey[];

/** The name a command is offered under, and written with, in a language (`/özet`, `/summary`). */
export function commandName(key: CommandKey, language: string): string {
  return language === 'tr' ? COMMANDS[key].tr : COMMANDS[key].en;
}

/** Every name a command answers to, the offered ones first. */
export function commandNames(key: CommandKey): string[] {
  const c: { tr: string; en: string; also?: readonly string[] } = COMMANDS[key];
  return [...new Set([c.tr, c.en, ...(c.also ?? [])])];
}

const BY_NAME = new Map<string, CommandKey>(COMMAND_KEYS.flatMap((key) => commandNames(key).map((n) => [n, key])));

/**
 * The command a message starts with and what follows it; undefined when the text is no command. Capitals are
 * taken either way (`/HATIRLA` in Turkish capitals, `/STATUS` in English ones).
 */
export function parseCommand(text: string): { key: CommandKey; rest: string } | undefined {
  const m = /^(\/\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m?.[1]) return undefined;
  const key = BY_NAME.get(m[1].toLowerCase()) ?? BY_NAME.get(m[1].toLocaleLowerCase('tr'));
  return key ? { key, rest: m[2]?.trim() ?? '' } : undefined;
}
