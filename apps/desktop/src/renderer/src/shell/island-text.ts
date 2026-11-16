// What the island shows of an agent's text (Island.tsx).

/**
 * What an agent wrote, as plain words for a bubble: code blocks (commands, scripts, diffs) are left out and
 * Markdown marks are dropped. An unfinished block of a streaming answer is left out too.
 */
export function plain(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*|__/g, '')
    .replace(/(^|[\s(])[_*]([^_*\n]+)[_*](?=[\s.,;:!?)]|$)/gm, '$1$2')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
