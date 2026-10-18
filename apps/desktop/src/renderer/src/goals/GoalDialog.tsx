// `/goal`: the goal, the agent that works on it, its budget and the done check.
import { Button, IconButton, Switch, TextField } from '@lonca/ui';
import { motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorLine } from '../parts';
import { useApp } from '../store';

export function GoalDialog() {
  const { t } = useTranslation();
  const target = useApp((s) => s.goalDialog);
  const agents = useApp((s) => s.workspace?.agents);
  const createGoal = useApp((s) => s.createGoal);
  const close = useCallback(() => useApp.getState().openGoalDialog(undefined), []);
  const [text, setText] = useState(target?.text ?? '');
  const [agentId, setAgentId] = useState(target?.agentId ?? agents?.[0]?.id ?? '');
  const [steps, setSteps] = useState('10');
  const [minutes, setMinutes] = useState('60');
  const [tokens, setTokens] = useState('');
  const [check, setCheck] = useState('');
  const [apart, setApart] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  if (!target) return null;
  const list = agents ?? [];
  const tokenLimit = tokens.trim() ? Number(tokens) * 1000 : undefined;

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
        aria-label={t('goal.new')}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 460, damping: 34 } }}
        exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await createGoal({
            channelId: target.channelId,
            agentId,
            text,
            budget: {
              steps: Number(steps) || 10,
              minutes: Number(minutes) || 60,
              ...(tokenLimit ? { tokens: tokenLimit } : {}),
            },
            ...(check.trim() ? { check: check.trim() } : {}),
            ...(apart ? { worktree: true } : {}),
          });
          setBusy(false);
        }}
      >
        <header className="agentform__head">
          <h2>{t('goal.new')}</h2>
          <IconButton icon="close" label={t('common.close')} onClick={close} />
        </header>
        <div className="agentform__body">
          <p className="muted">{t('goal.intro')}</p>
          <div className="l-field">
            <label className="l-field__label" htmlFor="goal-text">
              {t('goal.text')}
            </label>
            <textarea
              id="goal-text"
              className="l-input agentform__text"
              value={text}
              maxLength={4000}
              required
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          {list.length === 0 ? (
            <p className="muted">{t('goal.noAgent')}</p>
          ) : (
            <div className="l-field">
              <label className="l-field__label" htmlFor="goal-agent">
                {t('goal.agent')}
              </label>
              <select id="goal-agent" className="l-input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                {list.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} (@{a.handle}) · {t(`agentForm.modes.${a.mode}`)}
                  </option>
                ))}
              </select>
              <span className="l-field__hint">{t('goal.agentHint')}</span>
            </div>
          )}
          <div className="goalform__budget">
            <TextField
              label={t('goal.maxSteps')}
              type="number"
              min={1}
              max={50}
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
            />
            <TextField
              label={t('goal.maxMinutes')}
              type="number"
              min={1}
              max={1440}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
            <TextField
              label={t('goal.maxTokens')}
              type="number"
              min={1}
              placeholder={t('goal.noLimit')}
              value={tokens}
              onChange={(e) => setTokens(e.target.value)}
            />
          </div>
          <TextField
            label={t('goal.check')}
            value={check}
            maxLength={500}
            spellCheck={false}
            className="prov__url-field"
            placeholder="pnpm test"
            hint={t('goal.checkHint')}
            onChange={(e) => setCheck(e.target.value)}
          />
          <div className="row-field">
            <Switch checked={apart} onChange={setApart} label={t('goal.worktree')} />
            <div>
              <span>{t('goal.worktree')}</span>
              <p className="l-field__hint">{t('goal.worktreeHint')}</p>
            </div>
          </div>
          <ErrorLine />
        </div>
        <footer className="agentform__foot">
          <span className="grow" />
          <Button variant="quiet" onClick={close}>
            {t('agentForm.cancel')}
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!text.trim() || !agentId}>
            {t('goal.start')}
          </Button>
        </footer>
      </motion.form>
    </motion.div>
  );
}
