// The CLI agents Lonca knows how to find and drive. Its own module so every other one can import it.
export const CLI_KINDS = ['claude-code', 'codex', 'opencode', 'gemini', 'antigravity'] as const;
export type CliKind = (typeof CLI_KINDS)[number];
