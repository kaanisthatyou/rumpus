// `/yarış` (`/race`): one task for several of this computer's agents at once, each in a git worktree of its own.
import { Button, Chip, IconButton } from '@lonca/ui';
import { motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorLine } from '../parts';
import { useOwnAgents } from '../settings/AgentChecks';
import { useApp } from '../store';

const MIN = 2;
const MAX = 4;

export function RaceDialog() {
  const { t } = useTranslation();
  const target = useApp((s) => s.raceDialog);
  const agents = useOwnAgents();
  const startRace = useApp((s) => s.startRace);
  const close = useCallback(() => useApp.getState().openRaceDialog(undefined), []);
  const [task, setTask] = useState(target?.text ?? '');
  /** In the order they were chosen: the first one's folder names the repository. */
  const [chosen, setChosen] = useState<string[]>(() => agents.slice(0, MIN).map((a) => a.id));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  if (!target) return null;
  const first = agents.find((a) => a.id === chosen[0]);
  const ready = task.trim() !== '' && chosen.length >= MIN && chosen.length <= MAX;

  return (
    <motion.div
      className="l-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <motion.form
        className="l-dialog agentform"
        role="dialog"
        aria-modal="true"
        aria-label={t('race.new')}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 460, damping: 34 } }}
        exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready) return;
          setBusy(true);
          await startRace({ channelId: target.channelId, task: task.trim(), agentIds: chosen });
          setBusy(false);
        }}
      >
        <header className="agentform__head">
          <h2>{t('race.new')}</h2>
          <IconButton icon="close" label={t('common.close')} onClick={close} />
        </header>
        <div className="agentform__body">
          <p className="muted">{t('race.intro')}</p>
          <div className="l-field">
            <label className="l-field__label" htmlFor="race-task">
              {t('race.task')}
            </label>
            <textarea
              id="race-task"
              className="l-input agentform__text"
              value={task}
              maxLength={4000}
              required
              onChange={(e) => setTask(e.target.value)}
            />
          </div>
          <fieldset className="l-field raceform__agents">
            <legend className="l-field__label">{t('race.agents')}</legend>
            {agents.length < MIN && <p className="muted">{t('race.tooFew')}</p>}
            {agents.map((a) => {
              const on = chosen.includes(a.id);
              return (
                <label key={a.id} className="raceform__agent">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && chosen.length >= MAX}
                    onChange={() => setChosen((c) => (on ? c.filter((id) => id !== a.id) : [...c, a.id]))}
                  />
                  <span>
                    {a.name} <span className="muted">@{a.handle}</span>
                  </span>
                  <Chip mono>{a.kind}</Chip>
                  <Chip mono>{t(`agentForm.modes.${a.mode}`)}</Chip>
                </label>
              );
            })}
            <span className="l-field__hint">{t('race.agentsHint')}</span>
          </fieldset>
          {first && (
            <div className="l-field">
              <span className="l-field__label">{t('race.repo')}</span>
              <code className="l-mono raceform__repo">{first.folder}</code>
              <span className="l-field__hint">{t('race.repoHint')}</span>
            </div>
          )}
          <ErrorLine />
        </div>
        <footer className="agentform__foot">
          <span className="grow" />
          <Button variant="quiet" onClick={close}>
            {t('agentForm.cancel')}
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!ready}>
            {t('race.start')}
          </Button>
        </footer>
      </motion.form>
    </motion.div>
  );
}
