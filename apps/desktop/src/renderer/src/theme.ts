import type { Settings, TextSize } from '@lonca/protocol';
import { useEffect } from 'react';

const TITLE_BAR = {
  dark: { background: '#08090a', symbols: '#969ca7' },
  light: { background: '#eceef1', symbols: '#5b616b' },
} as const;

/** The text sizes as zoom factors of the whole window. */
const ZOOM: Record<TextSize, number> = { small: 0.9, normal: 1, large: 1.12 };

/**
 * Mirrors theme, accent, motion, density and language onto <html>, keeps the window frame in the same colors, and
 * sets the window's zoom to the text size.
 */
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
      root.dataset.density = settings.density;
      root.lang = settings.language;
      void window.lonca.shell.setTitleBar(TITLE_BAR[theme]);
    };
    apply();
    void window.lonca.shell.setZoom(ZOOM[settings.textSize] ?? 1);
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings]);
}
