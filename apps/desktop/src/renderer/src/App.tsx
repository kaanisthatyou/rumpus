import { Mark } from '@lonca/ui';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { AgentDialog } from './agents/AgentDialog';
import { Launcher } from './launcher/Launcher';
import { Palette, ShortcutsDialog } from './palette/Palette';
import { SettingsDialog } from './settings/SettingsDialog';
import { Shell } from './shell/Shell';
import { TitleBar } from './shell/TitleBar';
import { useApp } from './store';
import { useAppearance } from './theme';

function Boot() {
  return (
    <motion.div className="boot" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.3 } }}>
      <Mark size={40} />
    </motion.div>
  );
}

export function App() {
  const settings = useApp((s) => s.settings);
  const agentDialog = useApp((s) => s.agentDialog);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const shortcutsOpen = useApp((s) => s.shortcutsOpen);
  const init = useApp((s) => s.init);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const onboarded = settings?.onboarded === true;

  useEffect(() => {
    void init();
  }, [init]);
  useAppearance(settings);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!onboarded) return;
      const s = useApp.getState();
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        setSettingsOpen((open) => !open);
      } else if (e.ctrlKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        s.setPalette(!s.paletteOpen);
      } else if (e.ctrlKey && e.key === '/') {
        e.preventDefault();
        s.setShortcuts(!s.shortcutsOpen);
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        // Channels in sidebar order, wrapping around.
        const list = s.workspace?.channels ?? [];
        if (list.length === 0) return;
        e.preventDefault();
        const i = list.findIndex((c) => c.id === s.channelId);
        const next = list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1) + list.length) % list.length];
        if (next) void s.openChannel(next.id);
      } else if (e.ctrlKey && e.key === '.') {
        const running = Object.values(s.jobs)
          .filter((j) => j.channelId === s.channelId && j.state === 'running')
          .sort((a, b) => b.started - a.started)[0];
        if (running) {
          e.preventDefault();
          void s.stopJob(running.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onboarded]);

  return (
    <MotionConfig reducedMotion={settings?.motion === 'reduced' ? 'always' : 'user'}>
      <div className="app">
        <TitleBar />
        <div className="app__body">
          {!settings ? (
            <Boot />
          ) : (
            <AnimatePresence mode="wait">
              {onboarded ? <Shell key="shell" onSettings={openSettings} /> : <Launcher key="launcher" />}
            </AnimatePresence>
          )}
        </div>
        <AnimatePresence>{settingsOpen && <SettingsDialog onClose={closeSettings} />}</AnimatePresence>
        <AnimatePresence>{agentDialog && <AgentDialog key="agent-dialog" />}</AnimatePresence>
        <AnimatePresence>
          {onboarded && paletteOpen && <Palette key="palette" onSettings={openSettings} />}
        </AnimatePresence>
        <AnimatePresence>{onboarded && shortcutsOpen && <ShortcutsDialog key="shortcuts" />}</AnimatePresence>
      </div>
    </MotionConfig>
  );
}
