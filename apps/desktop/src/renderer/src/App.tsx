import { Mark } from '@lonca/ui';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { AdvisorDialog } from './agents/AdvisorDialog';
import { AgentDialog } from './agents/AgentDialog';
import { SpecialistDialog } from './agents/SpecialistDialog';
import { GoalDialog } from './goals/GoalDialog';
import { actionFor } from './keys';
import { Launcher } from './launcher/Launcher';
import { Palette, ShortcutsDialog } from './palette/Palette';
import { ProjectDialog } from './projects/ProjectDialog';
import { RoutineDialog } from './routines/RoutinesView';
import { SettingsDialog } from './settings/SettingsDialog';
import { InviteDialog } from './shell/InviteDialog';
import { NewWorkspaceDialog } from './shell/NewWorkspaceDialog';
import { Shell } from './shell/Shell';
import { StatusDialog } from './shell/StatusDialog';
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
  const specialistDialog = useApp((s) => s.specialistDialog);
  const routineDialog = useApp((s) => s.routineDialog);
  const advisorDialog = useApp((s) => s.advisorDialog);
  const goalDialog = useApp((s) => s.goalDialog);
  const projectDialog = useApp((s) => s.projectDialog);
  const statusOpen = useApp((s) => s.statusOpen);
  const newWorkspaceOpen = useApp((s) => s.newWorkspaceOpen);
  const inviteOpen = useApp((s) => s.inviteOpen);
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
      // While a shortcut is being recorded in Settings, keys belong to the recorder.
      if (s.recording) return;
      const action = actionFor(e, s.settings);
      if (!action) return;
      const go = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      const waiting = () =>
        Object.values(s.jobs)
          .filter((j) => j.state === 'attention')
          .sort((a, b) => a.started - b.started);
      const step = <T,>(list: T[], current: number, down: boolean) =>
        list[(current + (down ? 1 : list.length - 1) + list.length) % list.length];
      switch (action) {
        case 'settings':
          return go(() => setSettingsOpen((open) => !open));
        case 'palette':
          return go(() => s.setPalette(!s.paletteOpen));
        case 'shortcuts':
          return go(() => s.setShortcuts(!s.shortcutsOpen));
        case 'prevChannel':
        case 'nextChannel': {
          const list = s.workspace?.channels ?? [];
          if (list.length === 0) return;
          const next = step(
            list,
            list.findIndex((c) => c.id === s.channelId),
            action === 'nextChannel',
          );
          return go(() => next && void s.openChannel(next.id));
        }
        case 'prevWaiting':
        case 'nextWaiting': {
          const list = waiting();
          if (list.length === 0) return;
          const next = step(
            list,
            list.findIndex((j) => j.id === s.watching),
            action === 'nextWaiting',
          );
          return go(() => next && void s.openJob(next.id));
        }
        case 'quickEntry':
          // Reaches the page only when the key could not be registered globally.
          return go(() => void window.lonca.quick.open());
        case 'stop': {
          const running = Object.values(s.jobs)
            .filter((j) => j.channelId === s.channelId && (j.state === 'running' || j.state === 'attention'))
            .sort((a, b) => b.started - a.started)[0];
          if (running) go(() => void s.stopJob(running.id));
          return;
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
        <AnimatePresence>{specialistDialog && <SpecialistDialog key="specialist-dialog" />}</AnimatePresence>
        <AnimatePresence>{routineDialog && <RoutineDialog key="routine-dialog" />}</AnimatePresence>
        <AnimatePresence>{advisorDialog && <AdvisorDialog key="advisor-dialog" />}</AnimatePresence>
        <AnimatePresence>{goalDialog && <GoalDialog key="goal-dialog" />}</AnimatePresence>
        <AnimatePresence>
          {projectDialog && <ProjectDialog key={projectDialog === 'new' ? 'new' : projectDialog.id} />}
        </AnimatePresence>
        <AnimatePresence>{onboarded && newWorkspaceOpen && <NewWorkspaceDialog key="new-workspace" />}</AnimatePresence>
        <AnimatePresence>{onboarded && inviteOpen && <InviteDialog key="invite" />}</AnimatePresence>
        <AnimatePresence>{onboarded && statusOpen && <StatusDialog key="status" />}</AnimatePresence>
        <AnimatePresence>
          {onboarded && paletteOpen && <Palette key="palette" onSettings={openSettings} />}
        </AnimatePresence>
        <AnimatePresence>{onboarded && shortcutsOpen && <ShortcutsDialog key="shortcuts" />}</AnimatePresence>
      </div>
    </MotionConfig>
  );
}
