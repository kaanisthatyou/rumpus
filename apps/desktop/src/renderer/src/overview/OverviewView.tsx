// The workspace at a glance: what runs now, who is here with which agents, where the projects stand, what
// finished lately, today's numbers, and (until it is done or hidden) the steps of setting a workspace up.
import type { Agent, Job, Overview } from '@lonca/protocol';
import { Avatar, Button, Chip, Icon, IconButton, type IconName, LiveDot, Track } from '@lonca/ui';
import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { remoteOwner } from '../agents/owner';
import { specialistIcon } from '../agents/SpecialistDialog';
import { clock, elapsed, tokens } from '../channel/format';
import { core } from '../rpc';
import { useApp } from '../store';

const HIDDEN = 'lonca.setup.hidden';
const rise = { hidden: { opacity: 0, y: 8 }, shown: { opacity: 1, y: 0 } };

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <b className="stat__value">{value}</b>
      {note && <span className="stat__note">{note}</span>}
    </div>
  );
}

/** Jobs per day over the last week: one series, so no legend; each bar says its numbers on hover and focus. */
function Week({ days }: { days: Overview['days'] }) {
  const { t, i18n } = useTranslation();
  const most = Math.max(1, ...days.map((d) => d.jobs));
  const [at, setAt] = useState<number>();
  const shown = at === undefined ? undefined : days[at];
  return (
    <div className="week">
      <div className="week__head">
        <span className="stat__label">{t('overview.week')}</span>
        <span className="week__tip l-mono" role="status">
          {shown
            ? `${new Date(`${shown.day}T12:00:00`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })} · ${t('overview.jobs', { count: shown.jobs })} · ${tokens(shown.tokens, i18n.language)} token`
            : t('overview.jobs', { count: days.reduce((n, d) => n + d.jobs, 0) })}
        </span>
      </div>
      <div className="week__bars">
        {days.map((d, i) => {
          const date = new Date(`${d.day}T12:00:00`);
          const label = date.toLocaleDateString(i18n.language, { weekday: 'short' });
          return (
            <button
              key={d.day}
              type="button"
              className={`week__day ${i === days.length - 1 ? 'is-today' : ''}`}
              aria-label={`${date.toLocaleDateString(i18n.language, { weekday: 'long' })}: ${t('overview.jobs', { count: d.jobs })}`}
              onMouseEnter={() => setAt(i)}
              onMouseLeave={() => setAt(undefined)}
              onFocus={() => setAt(i)}
              onBlur={() => setAt(undefined)}
            >
              <span className="week__track">
                <motion.span
                  className="week__bar"
                  initial={{ height: 0 }}
                  animate={{ height: d.jobs === 0 ? 2 : `${Math.max(8, (d.jobs / most) * 100)}%` }}
                  transition={{ type: 'spring', stiffness: 260, damping: 28, delay: i * 0.03 }}
                  data-empty={d.jobs === 0 || undefined}
                />
              </span>
              <span className="week__name">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RunningJob({ job, agent, now }: { job: Job; agent: Agent | undefined; now: number }) {
  const { t } = useTranslation();
  const openJob = useApp((s) => s.openJob);
  const channel = useApp((s) => s.workspace?.channels.find((c) => c.id === job.channelId));
  const owner = useApp((s) => remoteOwner(agent, s.workspace));
  const last = job.steps.at(-1);
  const waiting = job.state === 'attention';
  return (
    <motion.li variants={rise}>
      <button type="button" className={`run ${waiting ? 'is-waiting' : ''}`} onClick={() => void openJob(job.id)}>
        <Avatar name="" icon={agent?.specialty ? specialistIcon(agent) : 'terminal'} size={30} presence="busy" />
        <span className="run__text">
          <b>
            {agent?.name ?? '—'}
            <span className="run__where">
              {channel?.kind === 'agent' ? `@${channel.name}` : `#${channel?.name ?? ''}`}
              {owner ? ` · ${owner}` : ''}
            </span>
          </b>
          <span className="run__step">
            {waiting
              ? `${t('job.approval.title')}${job.approval?.arg ? ` · ${job.approval.arg}` : ''}`
              : last
                ? `${t(`job.tool.${last.label}`, last.label)}${last.arg ? ` · ${last.arg}` : ''}`
                : t('crew.running')}
          </span>
          {job.budget && <Track value={Math.min(1, (now - job.started) / (job.budget.minutes * 60_000))} />}
        </span>
        <span className="run__time l-mono">
          {!waiting && <LiveDot />}
          {elapsed(job.started, now)}
        </span>
      </button>
    </motion.li>
  );
}

interface Step {
  id: string;
  icon: IconName;
  done: boolean;
  act: () => void;
}

function Setup({ steps, onHide }: { steps: Step[]; onHide: () => void }) {
  const { t } = useTranslation();
  const done = steps.filter((s) => s.done).length;
  return (
    <motion.section className="setup" variants={rise} aria-label={t('overview.setup.title')}>
      <header className="setup__head">
        <div>
          <h3>{t('overview.setup.title')}</h3>
          <span className="l-mono">
            {done} / {steps.length}
          </span>
        </div>
        <Track value={done / steps.length} />
        <IconButton size="sm" icon="close" label={t('overview.setup.hide')} onClick={onHide} />
      </header>
      <ul className="setup__list">
        {steps.map((s) => (
          <li key={s.id} className={`setup__step ${s.done ? 'is-done' : ''}`}>
            <span className="setup__mark">
              <Icon name={s.done ? 'check' : s.icon} size={14} />
            </span>
            <span className="setup__text">
              <b>{t(`overview.setup.${s.id}.title`)}</b>
              <span title={t(`overview.setup.${s.id}.hint`)}>{t(`overview.setup.${s.id}.hint`)}</span>
            </span>
            {!s.done && (
              <Button size="sm" onClick={s.act}>
                {t(`overview.setup.${s.id}.act`)}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </motion.section>
  );
}

export function OverviewView({ onSettings }: { onSettings: () => void }) {
  const { t, i18n } = useTranslation();
  const workspace = useApp((s) => s.workspace);
  const jobs = useApp((s) => s.jobs);
  const goals = useApp((s) => s.goals);
  const projects = useApp((s) => s.projects);
  const workspaces = useApp((s) => s.workspaces);
  const phone = useApp((s) => s.settings?.phone);
  const overview = useApp((s) => s.overview);
  const openChannel = useApp((s) => s.openChannel);
  const openProject = useApp((s) => s.openProject);
  const lang = i18n.language;
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDDEN) === '1';
    } catch {
      return false;
    }
  });

  const running = useMemo(
    () =>
      Object.values(jobs)
        .filter((j) => j.state === 'running' || j.state === 'attention')
        .sort((a, b) => a.started - b.started),
    [jobs],
  );
  const now = useNow(running.length > 0);
  const agents = workspace?.agents ?? [];
  const advisors = workspace?.advisors ?? [];
  const activeGoals = goals.filter((g) => ['planning', 'review', 'running', 'paused'].includes(g.state));

  // Loaded when the page opens, and again whenever a job starts or ends.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the count of running jobs is the trigger
  useEffect(() => {
    let live = true;
    core
      .call('overview.get')
      .then((o) => live && useApp.setState({ overview: o }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [running.length, workspace?.id]);

  const steps: Step[] = [
    {
      id: 'agent',
      icon: 'terminal',
      done: agents.some((a) => !a.specialty),
      act: () => useApp.getState().openAgentDialog('new'),
    },
    {
      id: 'specialist',
      icon: 'spark',
      done: agents.some((a) => a.specialty),
      act: () => useApp.getState().openSpecialistDialog('new'),
    },
    {
      id: 'project',
      icon: 'folder',
      done: projects.length > 0,
      act: () => useApp.getState().openProjectDialog('new'),
    },
    {
      id: 'advisor',
      icon: 'chat',
      done: advisors.length > 0,
      act: () => useApp.getState().openAdvisorDialog('new'),
    },
    {
      id: 'team',
      icon: 'users',
      done: workspaces.some((w) => w.kind === 'team'),
      act: () => useApp.setState({ newWorkspaceOpen: true }),
    },
    { id: 'phone', icon: 'monitor', done: Boolean(phone), act: onSettings },
  ];
  const setupOpen = !hidden && steps.some((s) => !s.done);

  // People and the agents that run on their computers: the personal workspace has one person.
  const people = workspace?.members ?? [
    { device: workspace?.me.id ?? '', name: workspace?.me.name ?? '', role: 'admin' as const, me: true, online: true },
  ];
  const busy = new Set(running.map((j) => j.agentId));
  const today = overview?.today;
  const title = workspace?.kind === 'team' ? workspace.name : t('shell.workspace');

  return (
    <main className="chat home">
      <header className="chat__head">
        <h2>
          <Icon name="home" size={15} />
          {t('shell.home')}
        </h2>
        <span className="chat__topic">
          {title} · {new Date().toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
      </header>
      <motion.div
        className="home__body"
        variants={{ shown: { transition: { staggerChildren: 0.05 } } }}
        initial="hidden"
        animate="shown"
      >
        {setupOpen && (
          <Setup
            steps={steps}
            onHide={() => {
              setHidden(true);
              try {
                localStorage.setItem(HIDDEN, '1');
              } catch {
                // hidden until the page is reloaded then
              }
            }}
          />
        )}

        <motion.section className="home__stats" variants={rise} aria-label={t('overview.today')}>
          <Stat
            label={t('overview.stat.jobs')}
            value={String(today?.jobs ?? 0)}
            {...(today?.failed ? { note: t('overview.stat.failed', { count: today.failed }) } : {})}
          />
          <Stat
            label={t('overview.stat.tokens')}
            value={tokens((today?.usage.in ?? 0) + (today?.usage.out ?? 0), lang)}
            note={t('overview.stat.cached', { count: tokens(today?.usage.cached ?? 0, lang) })}
          />
          <Stat label={t('overview.stat.cost')} value={`$${(today?.cost ?? 0).toFixed(2)}`} />
          <Stat label={t('overview.stat.messages')} value={String(today?.messages ?? 0)} />
          {overview && <Week days={overview.days} />}
        </motion.section>

        <div className="home__cols">
          <div className="home__col">
            <motion.section className="panel" variants={rise}>
              <h3>
                {t('overview.now')}
                {running.length > 0 && <span className="badge-count">{running.length}</span>}
              </h3>
              {running.length === 0 ? (
                <p className="panel__none">{t('overview.nowNone')}</p>
              ) : (
                <motion.ul className="panel__list" initial="hidden" animate="shown">
                  {running.map((j) => (
                    <RunningJob key={j.id} job={j} agent={agents.find((a) => a.id === j.agentId)} now={now} />
                  ))}
                </motion.ul>
              )}
              {activeGoals.map((g) => {
                const done = g.steps.filter((s) => s.state === 'done').length;
                return (
                  <button key={g.id} type="button" className="goalrow" onClick={() => void openChannel(g.channelId)}>
                    <Icon name="target" size={14} />
                    <span className="goalrow__text">{g.text}</span>
                    <Chip mono>{t(`goal.state.${g.state}`)}</Chip>
                    <span className="l-mono goalrow__n">
                      {done} / {g.steps.length}
                    </span>
                  </button>
                );
              })}
            </motion.section>

            <motion.section className="panel" variants={rise}>
              <h3>{t('overview.recent')}</h3>
              {!overview || overview.recent.length === 0 ? (
                <p className="panel__none">{t('overview.recentNone')}</p>
              ) : (
                <ul className="panel__list">
                  {overview.recent.map(({ job, request, channel }) => {
                    const agent = agents.find((a) => a.id === job.agentId);
                    const ok = job.state === 'done';
                    return (
                      <li key={job.id}>
                        <button type="button" className="past" onClick={() => void openChannel(job.channelId)}>
                          <span className={`past__mark ${ok ? 'is-ok' : 'is-off'}`}>
                            <Icon name={ok ? 'check' : 'close'} size={11} />
                          </span>
                          <span className="past__text">
                            <b>{request || '—'}</b>
                            <span>
                              {agent?.name ?? '—'} · #{channel} · {t(`job.state.${job.state}`)}
                            </span>
                          </span>
                          <span className="past__meta l-mono">
                            <span>{elapsed(job.started, job.ended ?? job.started)}</span>
                            <span>{clock(job.ended ?? job.started)}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </motion.section>
          </div>

          <div className="home__col">
            <motion.section className="panel" variants={rise}>
              <h3>{t('overview.people')}</h3>
              <ul className="panel__list">
                {people.map((m) => {
                  // Agents from before teams have no owner: they are this computer's.
                  const theirs = agents.filter((a) => (a.owner ?? workspace?.me.id) === m.device);
                  return (
                    <li key={m.device} className="person">
                      <div className="person__head">
                        <Avatar name={m.name} size={28} presence={m.online ? 'on' : 'off'} />
                        <b>{m.name}</b>
                        <span className="person__role">{t(`shell.role.${m.role}`)}</span>
                      </div>
                      {theirs.length === 0 ? (
                        <span className="person__none">{t('overview.noAgents')}</span>
                      ) : (
                        <div className="person__agents">
                          {theirs.map((a) => (
                            <span
                              key={a.id}
                              className={`agentpill ${busy.has(a.id) ? 'is-busy' : ''}`}
                              title={a.specialty?.role}
                            >
                              <Icon name={a.specialty ? specialistIcon(a) : 'terminal'} size={12} />
                              {a.name}
                              {busy.has(a.id) && <LiveDot />}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </motion.section>

            <motion.section className="panel" variants={rise}>
              <h3>{t('shell.projects')}</h3>
              {projects.length === 0 ? (
                <p className="panel__none">{t('overview.projectsNone')}</p>
              ) : (
                <ul className="panel__list">
                  {projects.map((p) => {
                    const total = p.status.milestones.length;
                    const done = p.status.milestones.filter((m) => m.done).length;
                    return (
                      <li key={p.id}>
                        <button type="button" className="proj" onClick={() => openProject(p.id)}>
                          <span className="proj__head">
                            <Icon name="folder" size={14} />
                            <b>{p.name}</b>
                            {total > 0 && (
                              <span className="l-mono proj__n">
                                {done} / {total}
                              </span>
                            )}
                          </span>
                          {total > 0 && <Track value={done / total} />}
                          {p.status.leftOff && <span className="proj__left">{p.status.leftOff}</span>}
                          {p.status.next[0] && (
                            <span className="proj__next">
                              <Icon name="chevronRight" size={12} />
                              {p.status.next[0]}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </motion.section>
          </div>
        </div>
      </motion.div>
    </main>
  );
}
