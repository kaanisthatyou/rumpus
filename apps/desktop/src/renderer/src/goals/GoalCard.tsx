// A goal under its `/goal` message: the plan with comments while it waits for approval, then the steps as they
// run, the budget used, and the last done check.
import type { Agent, Goal, GoalComment, GoalStep } from '@lonca/protocol';
import { Button, Chip, Icon, IconButton, LiveDot } from '@lonca/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../store';

const OPEN = new Set(['planning', 'review', 'running']);

function StepIcon({ step }: { step: GoalStep }) {
  if (step.state === 'running') return <span className="l-spinner goalstep__spin" aria-hidden="true" />;
  if (step.state === 'done') return <Icon name="check" size={13} />;
  if (step.state === 'failed') return <Icon name="alert" size={13} />;
  return <span className="goalstep__dot" aria-hidden="true" />;
}

export function GoalCard({ goal, agent }: { goal: Goal; agent: Agent | undefined }) {
  const { t } = useTranslation();
  const approveGoal = useApp((s) => s.approveGoal);
  const stopGoal = useApp((s) => s.stopGoal);
  const resumeGoal = useApp((s) => s.resumeGoal);
  const removeWorktree = useApp((s) => s.removeWorktree);
  const openJob = useApp((s) => s.openJob);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string>();
  const [busy, setBusy] = useState(false);
  const review = goal.state === 'review';
  const written: GoalComment[] = Object.entries(comments)
    .filter(([, text]) => text.trim())
    .map(([key, text]) => ({ ...(key === 'plan' ? {} : { stepId: key }), text: text.trim() }));
  const minutes = Math.floor(goal.used.ms / 60_000);
  const tokens = Math.round(goal.used.tokens / 1000);

  const commentBox = (key: string, label: string) => (
    <motion.div
      className="goalstep__comment"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
    >
      <textarea
        className="l-input"
        aria-label={label}
        value={comments[key] ?? ''}
        maxLength={1000}
        // biome-ignore lint/a11y/noAutofocus: the box opens on request and typing is the next step
        autoFocus
        onChange={(e) => setComments((c) => ({ ...c, [key]: e.target.value }))}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
            e.preventDefault();
            setOpen(undefined);
          }
        }}
      />
    </motion.div>
  );

  return (
    <motion.section
      className={`goal goal--${goal.state}`}
      aria-label={t('goal.title')}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      layout="position"
    >
      <header className="goal__head">
        <Icon name="target" size={16} />
        <b>{t('goal.title')}</b>
        {agent && <Chip mono>@{agent.handle}</Chip>}
        <span className="grow" />
        <span className={`goal__state goal__state--${goal.state}`}>
          {(goal.state === 'planning' || goal.state === 'running') && <LiveDot />}
          {t(`goal.state.${goal.state}`)}
        </span>
      </header>
      <p className="goal__text">{goal.text}</p>

      {goal.state === 'planning' && <p className="muted goal__note">{t('goal.planning')}</p>}

      {goal.steps.length > 0 && (
        <ol className="goal__steps">
          {goal.steps.map((s, i) => (
            <li key={s.id} className={`goalstep goalstep--${s.state}`}>
              <div className="goalstep__row">
                <span className="goalstep__icon">
                  <StepIcon step={s} />
                </span>
                <span className="goalstep__n l-mono">{i + 1}</span>
                <span className="goalstep__text">{s.fix ? t('goal.fixStep') : s.text}</span>
                {review && (
                  <IconButton
                    size="sm"
                    icon="pencil"
                    label={t('goal.commentOn', { n: i + 1 })}
                    onClick={() => setOpen(open === s.id ? undefined : s.id)}
                  />
                )}
                {s.jobId && !review && (
                  <IconButton
                    size="sm"
                    icon="search"
                    label={t('goal.watchStep', { n: i + 1 })}
                    onClick={() => s.jobId && openJob(s.jobId)}
                  />
                )}
              </div>
              {(comments[s.id]?.trim() || goal.comments.some((c) => c.stepId === s.id)) && open !== s.id && (
                <p className="goalstep__note">
                  <Icon name="chat" size={12} />
                  {review ? comments[s.id] : goal.comments.find((c) => c.stepId === s.id)?.text}
                </p>
              )}
              <AnimatePresence>{open === s.id && commentBox(s.id, t('goal.commentOn', { n: i + 1 }))}</AnimatePresence>
            </li>
          ))}
        </ol>
      )}

      {review && (
        <div className="goal__plancomment">
          <AnimatePresence>{open === 'plan' && commentBox('plan', t('goal.commentPlan'))}</AnimatePresence>
          {open !== 'plan' && comments.plan?.trim() && (
            <p className="goalstep__note">
              <Icon name="chat" size={12} />
              {comments.plan}
            </p>
          )}
        </div>
      )}
      {!review && goal.comments.some((c) => !c.stepId) && (
        <p className="goalstep__note">
          <Icon name="chat" size={12} />
          {goal.comments.find((c) => !c.stepId)?.text}
        </p>
      )}

      {goal.worktree && (
        <div className={`goal__tree ${goal.worktree.removed ? 'is-gone' : ''}`}>
          <Icon name="folder" size={13} />
          <span>{t('goal.branch')}</span>
          <code className="l-mono">{goal.worktree.branch}</code>
          <span className="grow" />
          {goal.worktree.removed ? (
            <span className="muted">{t('goal.worktreeRemoved')}</span>
          ) : (
            <>
              <Button
                size="sm"
                variant="quiet"
                onClick={() => goal.worktree && void window.lonca.shell.openFolder(goal.worktree.path)}
              >
                {t('goal.openFolder')}
              </Button>
              {!OPEN.has(goal.state) && (
                <Button size="sm" variant="quiet" icon="trash" onClick={() => void removeWorktree(goal.id)}>
                  {t('goal.removeWorktree')}
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {goal.lastCheck && (
        <details className={`goal__check ${goal.lastCheck.ok ? 'is-ok' : 'is-bad'}`}>
          <summary>
            <Icon name={goal.lastCheck.ok ? 'check' : 'alert'} size={13} />
            <span>{goal.lastCheck.ok ? t('goal.checkOk') : t('goal.checkFailed')}</span>
            <code className="l-mono">{goal.check}</code>
          </summary>
          {goal.lastCheck.output && <pre className="l-mono">{goal.lastCheck.output.slice(-1500)}</pre>}
        </details>
      )}

      {goal.state === 'paused' && goal.pause && <p className="goal__pause">{t(`goal.pause.${goal.pause}`)}</p>}

      <footer className="goal__foot">
        <span className="goal__used l-mono">
          {t('goal.used', {
            steps: goal.used.steps,
            maxSteps: goal.budget.steps,
            minutes,
            maxMinutes: goal.budget.minutes,
          })}
          {goal.budget.tokens
            ? ` · ${t('goal.tokens', { used: tokens, max: Math.round(goal.budget.tokens / 1000) })}`
            : ` · ${tokens}k token`}
        </span>
        <span className="grow" />
        {review && (
          <>
            <Button size="sm" variant="quiet" icon="chat" onClick={() => setOpen(open === 'plan' ? undefined : 'plan')}>
              {t('goal.commentPlan')}
            </Button>
            <Button size="sm" variant="quiet" onClick={() => void stopGoal(goal.id)}>
              {t('goal.reject')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                await approveGoal(goal.id, written);
                setBusy(false);
              }}
            >
              {written.length ? t('goal.approveWith', { count: written.length }) : t('goal.approve')}
            </Button>
          </>
        )}
        {(goal.state === 'planning' || goal.state === 'running') && (
          <Button size="sm" variant="quiet" icon="close" onClick={() => void stopGoal(goal.id)}>
            {t('goal.stop')}
          </Button>
        )}
        {goal.state === 'paused' && (
          <>
            <Button size="sm" variant="quiet" onClick={() => void stopGoal(goal.id)}>
              {t('goal.stop')}
            </Button>
            {goal.pause?.startsWith('budget') && (
              <Button
                size="sm"
                onClick={() =>
                  void resumeGoal(goal.id, {
                    steps: 5,
                    minutes: 30,
                    ...(goal.budget.tokens ? { tokens: 100_000 } : {}),
                  })
                }
              >
                {t('goal.more')}
              </Button>
            )}
            {!goal.pause?.startsWith('budget') && (
              <Button size="sm" variant="primary" onClick={() => void resumeGoal(goal.id)}>
                {t('goal.resume')}
              </Button>
            )}
          </>
        )}
      </footer>
    </motion.section>
  );
}

export const goalIsOpen = (g: Goal) => OPEN.has(g.state);
