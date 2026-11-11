import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type BrowserWindow, type Rectangle, screen } from 'electron';

interface Saved {
  bounds: Rectangle;
  maximized: boolean;
}

/**
 * The first window: wide enough for the channel list, the page and the crew panel side by side (1440 × 900), or
 * what the screen has room for.
 */
function firstSize(): { width: number; height: number } {
  const area = screen.getPrimaryDisplay().workAreaSize;
  return {
    width: Math.max(960, Math.min(1440, area.width - 80)),
    height: Math.max(640, Math.min(900, area.height - 60)),
  };
}

/** Remembers size, position and maximized state; ignores a position that is no longer on any screen. */
export function loadWindowState(appDir: string): Partial<Rectangle> & { maximized: boolean } {
  try {
    const saved = JSON.parse(readFileSync(join(appDir, 'window.json'), 'utf8')) as Saved;
    const b = saved.bounds;
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x + 80 < a.x + a.width && b.x + b.width - 80 > a.x && b.y >= a.y - 10 && b.y + 40 < a.y + a.height;
    });
    return visible
      ? { ...b, maximized: saved.maximized }
      : { width: b.width, height: b.height, maximized: saved.maximized };
  } catch {
    return { ...firstSize(), maximized: false };
  }
}

export function trackWindowState(win: BrowserWindow, appDir: string): void {
  let timer: NodeJS.Timeout | undefined;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const state: Saved = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
      try {
        writeFileSync(join(appDir, 'window.json'), JSON.stringify(state));
      } catch {
        // not worth failing over
      }
    }, 400);
  };
  win.on('resize', save);
  win.on('move', save);
  win.on('close', save);
}
