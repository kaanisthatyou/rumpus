// The taskbar shows what this computer's agents are doing while the window is elsewhere: a moving bar while jobs
// run, a held bar and a badge with their number while jobs wait for approval. The main process draws it; the page
// counts, and draws the badge.
import { useEffect } from 'react';
import { type AppState, useApp } from '../store';

/** Jobs in a state, of agents this computer runs (another member's agent works on their computer). */
function count(s: AppState, state: 'running' | 'attention'): number {
  const ws = s.workspace;
  let n = 0;
  for (const job of Object.values(s.jobs)) {
    if (job.state !== state) continue;
    const owner = ws?.agents.find((a) => a.id === job.agentId)?.owner;
    if (ws?.kind === 'team' && owner && owner !== ws.me.id) continue;
    n += 1;
  }
  return n;
}

/** The number of waiting jobs as a small round picture, in the warning color. */
function badge(n: number): string | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const g = canvas.getContext('2d');
  if (!g) return undefined;
  g.fillStyle = '#f2c14e';
  g.beginPath();
  g.arc(16, 16, 15, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#0a0b0d';
  g.font = '700 20px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(n > 9 ? '9+' : String(n), 16, 17);
  return canvas.toDataURL('image/png');
}

export function useTaskbar(): void {
  const running = useApp((s) => count(s, 'running'));
  const waiting = useApp((s) => count(s, 'attention'));
  useEffect(() => {
    const picture = waiting > 0 ? badge(waiting) : undefined;
    void window.lonca.shell.setActivity({ running, waiting, ...(picture ? { badge: picture } : {}) });
  }, [running, waiting]);
}
