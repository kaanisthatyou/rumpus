import type { Settings } from '@lonca/protocol';
import { useEffect } from 'react';

const TITLE_BAR = {
  dark: { background: '#08090a', symbols: '#969ca7' },
  light: { background: '#eceef1', symbols: '#5b616b' },
} as const;

/** Mirrors theme, accent, motion and language onto <html>, and keeps the window frame in the same colors. */
export function useAppearance(settings: Settings | undefined): void {
  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const theme = settings.theme === 'system' ? (media.matches ? 'light' : 'dark') : settings.theme;
      root.dataset.theme = theme;
      root.dataset.accent = settings.accent;
      root.dataset.motion = settings.motion;
      root.lang = settings.language;
      void window.lonca.shell.setTitleBar(TITLE_BAR[theme]);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings]);
}
