// A race in the channel (PLAN.md 5.18): its contestants side by side, each with what its job is doing now, how
// long it took, what it spent and changed, and its answer; then one is picked, or none.
import type { Agent, Job, Message, Race, RaceEntry } from '@lonca/protocol';
import { Avatar, Button, Chip, Icon, LiveDot, Track } from '@lonca/ui';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { specialistIcon } from '../agents/SpecialistDialog';
import { elapsed, tokens } from '../channel/format';
import { useNow } from '../channel/JobCard';
import { JobChanges } from '../channel/JobChanges';
import { Markdown } from '../channel/Markdown';
import { useApp } from '../store';

const NO_MESSAGES: Message[] = [];

function Lane({
  race,
  entry,
  agent,
  job,
  answer,
}: {
  race: Race;
  entry: RaceEntry;
  agent: Agent | undefined;
  job: Job | undefined;
  answer: string | undefined;
}) {
  const { t, i18n } = useTranslation();
  const watch = useApp((s) => s.watch);
  const pickRace = useApp((s) => s.pickRace);
  const [busy, setBusy] = useState(false);
  const running = job?.state === 'running' || job?.state === 'attention';
  const now = useNow(running);
  const winner = race.winner === entry.agentId;
  const step = job?.steps.at(-1);
  const files = job?.changes ? job.changes.files.length + (job.changes.more ?? 0) : 0;
  const added = job?.changes?.files.reduce((n, f) => n + f.added, 0) ?? 0;
  const removed = job?.changes?.files.reduce((n, f) => n + f.removed, 0) ?? 0;
  const lang = i18n.language;
  const canPick = (race.state === 'ready' || race.state === 'running') && entry.done && job?.state === 'done';

  return (
    <motion.li
      layout="position"
      className={`lane lane--${job?.state ?? 'running'} ${winner ? 'is-winner' : ''}`}
      aria-label={agent?.name ?? ''}
    >
      {running ? <Track busy /> : <div className="lane__rule" />}
      <div className="lane__head">
        <Avatar
          name=""
          icon={agent?.specialty ? specialistIcon(agent) : 'terminal'}
          size={24}
          presence={running ? 'busy' : job?.state === 'done' ? 'on' : 'off'}
        />
        <b>{agent?.name ?? '—'}</b>
        {entry.place !== undefined && (
          <span className={`lane__place ${entry.place === 1 ? 'is-first' : ''}`}>
            {t('race.place', { place: entry.place })}
          </span>
        )}
        <span className="grow" />
        {winner && <Chip tone="accent">{t('race.state.picked')}</Chip>}
      </div>
      <div className="lane__chips">
        {agent && <Chip mono>{agent.kind}</Chip>}
        {agent && <Chip mono>{t(`agentForm.modes.${agent.mode}`)}</Chip>}
      </div>
      <p className={`lane__state lane__state--${job?.state ?? 'running'}`}>
        {running && <LiveDot />}
        <span>{t(`job.state.${job?.state ?? 'running'}`)}</span>
        {job && <span className="l-mono">{elapsed(job.started, job.ended ?? now)}</span>}
      </p>
      {running && step && (
        <p className="lane__step">
          <span>{t(`job.tool.${step.label}`, step.label)}</span>
          {step.arg && <code>{step.arg}</code>}
        </p>
      )}
      {job && !running && (
        <p className="lane__numbers l-mono">
          {t('job.usage', {
            in: tokens(job.usage.in, lang),
            cached: tokens(job.usage.cached, lang),
            out: tokens(job.usage.out, lang),
          })}
          {job.cost ? ` · $${job.cost.toFixed(4)}` : ''}
        </p>
      )}
      {job && !running && (
        <p className="lane__changes l-mono">
          {files > 0 ? (
            <>
              {t('job.changes.files', { count: files })} <span className="jobfile__add">+{added}</span>{' '}
              <span className="jobfile__del">−{removed}</span>
            </>
          ) : (
            t('race.noChanges')
          )}
        </p>
      )}
      {answer && !running && (
        <div className="lane__answer">
          <Markdown text={answer} />
        </div>
      )}
      {job && !running && files > 0 && <JobChanges job={job} mine undo={false} />}
      <div className="lane__foot">
        {job && (
          <Button size="sm" variant="quiet" icon="search" onClick={() => watch(job.id)}>
            {t('job.watch')}
          </Button>
        )}
        <span className="grow" />
        {canPick && (
          <Button
            size="sm"
            variant="primary"
            icon="check"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              await pickRace(race.id, entry.agentId);
              setBusy(false);
            }}
          >
            {t('race.pick', { name: agent?.name ?? '' })}
          </Button>
        )}
      </div>
    </motion.li>
  );
}

export function RaceCard({ race }: { race: Race }) {
  const { t } = useTranslation();
  const agents = useApp((s) => s.workspace?.agents);
  const jobs = useApp((s) => s.jobs);
  const messages = useApp((s) => s.messages[race.channelId] ?? NO_MESSAGES);
  const stopRace = useApp((s) => s.stopRace);
  const closeRace = useApp((s) => s.closeRace);
  const [closing, setClosing] = useState(false);
  /** Each contestant's answer: the message its job ended with. */
  const answers = useMemo(() => {
    const byJob = new Map<string, string>();
    for (const m of messages) if (m.jobId) byJob.set(m.jobId, m.text);
    return byJob;
  }, [messages]);
  const winner = agents?.find((a) => a.id === race.winner);

  return (
    <section className={`race race--${race.state}`} aria-label={t('race.title')}>
      <header className="race__head">
        <Icon name="bolt" size={14} />
        <b>{t('race.title')}</b>
        <span className={`race__state race__state--${race.state}`}>{t(`race.state.${race.state}`)}</span>
        <span className="grow" />
        {race.state === 'running' && (
          <Button size="sm" variant="danger" icon="close" onClick={() => void stopRace(race.id)}>
            {t('job.stop')}
          </Button>
        )}
        {race.state === 'ready' &&
          (closing ? (
            <>
              <span className="muted">{t('race.closeConfirm')}</span>
              <Button size="sm" variant="danger" onClick={() => void closeRace(race.id)}>
                {t('race.close')}
              </Button>
              <Button size="sm" variant="quiet" onClick={() => setClosing(false)}>
                {t('common.cancel')}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="quiet" onClick={() => setClosing(true)}>
              {t('race.close')}
            </Button>
          ))}
      </header>
      <ul className="race__lanes">
        {race.entries.map((entry) => {
          const job = entry.jobId ? jobs[entry.jobId] : undefined;
          return (
            <Lane
              key={entry.agentId}
              race={race}
              entry={entry}
              agent={agents?.find((a) => a.id === entry.agentId)}
              job={job}
              answer={entry.jobId ? answers.get(entry.jobId) : undefined}
            />
          );
        })}
      </ul>
      {race.state === 'ready' && <p className="race__note">{t('race.readyNote')}</p>}
      {race.state === 'picked' && <p className="race__note">{t('race.pickedNote', { name: winner?.name ?? '' })}</p>}
      {race.state === 'closed' && <p className="race__note">{t('race.closedNote')}</p>}
    </section>
  );
}
