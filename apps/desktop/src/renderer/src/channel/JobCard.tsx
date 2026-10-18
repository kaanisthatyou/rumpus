import type { Agent, Job, JobStep } from '@lonca/protocol';
import { Avatar, Button, Chip, Icon, LiveDot, popIn, Spinner, Track } from '@lonca/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { remoteOwner } from '../agents/owner';
import { useApp } from '../store';
import { elapsed, tokens } from './format';

const SHOWN = 6;

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function StepRow({ step, last, running }: { step: JobStep; last: boolean; running: boolean }) {
  const { t } = useTranslation();
  const pending = step.kind === 'tool' && step.ok === undefined && last && running;
  const failed = step.ok === false || step.kind === 'denied';
  const label =
    step.kind === 'denied'
      ? `${t('job.denied')} · ${t(`job.tool.${step.label}`, step.label)}`
      : t(`job.tool.${step.label}`, step.label);
  return (
    <motion.li
      variants={popIn}
      className={`step step--${step.kind} ${failed ? 'is-failed' : ''} ${pending ? 'is-live' : ''}`}
    >
      <span className="step__icon">
        {pending ? (
          <Spinner />
        ) : failed ? (
          <Icon name="close" size={12} />
        ) : step.kind === 'steer' ? (
          <Icon name="chevronRight" size={12} />
        ) : (
          <Icon name="check" size={12} />
        )}
      </span>
      <span className="step__label">{label}</span>
      {step.arg && <code className="step__arg">{step.arg}</code>}
    </motion.li>
  );
}

export function JobCard({ job, agent }: { job: Job; agent: Agent | undefined }) {
  const { t, i18n } = useTranslation();
  const stopJob = useApp((s) => s.stopJob);
  const steerJob = useApp((s) => s.steerJob);
  const watch = useApp((s) => s.watch);
  const answerJob = useApp((s) => s.answerJob);
  const [steering, setSteering] = useState(false);
  const [draft, setDraft] = useState('');
  const running = job.state === 'running' || job.state === 'attention';
  // Another member's agent: the job runs on their computer; only they steer, stop, approve or watch it live.
  const owner = useApp((s) => remoteOwner(agent, s.workspace));
  const now = useNow(running);
  const hidden = Math.max(0, job.steps.length - SHOWN);
  const steps = job.steps.slice(-SHOWN);
  const lang = i18n.language;
  const error = job.error ? t(`job.error.${job.error.replace(/:.*$/s, '')}`, job.error) : undefined;

  return (
    <motion.div
      className={`job job--${job.state}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      layout="position"
    >
      <div className="job__head">
        <Avatar name="" icon="terminal" size={26} presence={running ? 'busy' : job.state === 'done' ? 'on' : 'off'} />
        <div className="job__who">
          <b>{agent?.name ?? '—'}</b>
          {agent && <Chip mono>{agent.kind}</Chip>}
          {agent && <Chip mono>{t(`agentForm.modes.${agent.mode}`)}</Chip>}
          {owner && <Chip>{t('agent.on', { name: owner })}</Chip>}
        </div>
        <span className={`job__state job__state--${job.state}`}>
          {running && <LiveDot />}
          {t(`job.state.${job.state}`)} · <span className="l-mono">{elapsed(job.started, job.ended ?? now)}</span>
        </span>
      </div>
      {running && <Track busy />}
      {job.steps.length > 0 && (
        <motion.ol
          className="job__steps"
          variants={{ shown: { transition: { staggerChildren: 0.04 } } }}
          initial="hidden"
          animate="shown"
        >
          {hidden > 0 && <li className="step step--more">{t('job.more', { count: hidden })}</li>}
          {steps.map((s, i) => (
            <StepRow key={s.id} step={s} last={i === steps.length - 1} running={running} />
          ))}
        </motion.ol>
      )}
      {/* No exit animation: an answered approval goes at once, so a closing panel never sits next to a new one. */}
      {job.state === 'attention' && job.approval && (
        <motion.div
          key={job.approval.id}
          className="job__approval"
          role="alert"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
        >
          <div className="job__approval-text">
            <b>{t('job.approval.title')}</b>
            <span>
              {t(`job.tool.${job.approval.label}`, job.approval.label)}
              {job.approval.arg && <code>{job.approval.arg}</code>}
            </span>
            {job.approval.detail && <span className="job__approval-detail">{job.approval.detail}</span>}
          </div>
          {owner ? (
            <span className="muted">{t('job.approval.owner', { name: owner })}</span>
          ) : (
            <>
              <Button size="sm" variant="danger" icon="close" onClick={() => void answerJob(job.id, false)}>
                {t('job.approval.deny')}
              </Button>
              <Button size="sm" variant="primary" icon="check" onClick={() => void answerJob(job.id, true)}>
                {t('job.approval.allow')}
              </Button>
            </>
          )}
        </motion.div>
      )}
      {running && job.preview && <p className="job__preview">{job.preview.slice(-280)}</p>}
      {error && job.state !== 'done' && <p className="job__error">{error}</p>}
      <div className="job__foot">
        <span className="job__usage l-mono">
          {t('job.usage', {
            in: tokens(job.usage.in, lang),
            cached: tokens(job.usage.cached, lang),
            out: tokens(job.usage.out, lang),
          })}
          {job.cost ? ` · $${job.cost.toFixed(4)}` : ''}
        </span>
        {!owner && (
          <Button size="sm" variant="quiet" icon="search" onClick={() => watch(job.id)}>
            {t('job.watch')}
          </Button>
        )}
        {running && !owner && (
          <>
            <Button size="sm" icon="chevronRight" onClick={() => setSteering((v) => !v)}>
              {t('job.steer')}
            </Button>
            <Button size="sm" variant="danger" icon="close" onClick={() => void stopJob(job.id)}>
              {t('job.stop')}
            </Button>
          </>
        )}
      </div>
      <AnimatePresence>
        {running && steering && (
          <motion.form
            className="job__steer"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (draft.trim() && (await steerJob(job.id, draft))) {
                setDraft('');
                setSteering(false);
              }
            }}
          >
            <input
              className="l-input"
              // biome-ignore lint/a11y/noAutofocus: the steer field opens on request and typing is the next step
              autoFocus
              value={draft}
              placeholder={t('job.steerPlaceholder')}
              aria-label={t('job.steer')}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setSteering(false)}
            />
          </motion.form>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
