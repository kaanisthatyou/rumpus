// Shortcut combos: `Ctrl+Alt+Shift+Key`, written the same way in settings and matched against key events.
import { type Settings, SHORTCUTS, type ShortcutAction } from '@lonca/protocol';

const MODIFIERS = new Set(['Control', 'Alt', 'Shift', 'Meta']);

/** The combo of a key event, or undefined for a lone modifier. */
export function comboOf(e: KeyboardEvent | React.KeyboardEvent): string | undefined {
  if (MODIFIERS.has(e.key)) return undefined;
  const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', key].filter(Boolean).join('+');
}

const ARROWS: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };

/** How a combo is shown: `Ctrl Shift ↓`. */
export function comboLabel(combo: string): string {
  return combo
    .split('+')
    .map((p) => ARROWS[p] ?? p)
    .join(' ');
}

export function bindings(settings: Settings | undefined): Record<ShortcutAction, string> {
  return { ...SHORTCUTS, ...(settings?.shortcuts ?? {}) } as Record<ShortcutAction, string>;
}

/** Which action a key event triggers, if any. */
export function actionFor(e: KeyboardEvent, settings: Settings | undefined): ShortcutAction | undefined {
  const combo = comboOf(e);
  if (!combo) return undefined;
  const map = bindings(settings);
  return (Object.keys(map) as ShortcutAction[]).find((a) => map[a] === combo);
}
