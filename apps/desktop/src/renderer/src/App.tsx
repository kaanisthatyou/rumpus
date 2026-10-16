import { Mark } from '@lonca/ui';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { Launcher } from './launcher/Launcher';
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
      if (e.ctrlKey && e.key === ',' && onboarded) {
        e.preventDefault();
        setSettingsOpen((open) => !open);
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
      </div>
    </MotionConfig>
  );
}
