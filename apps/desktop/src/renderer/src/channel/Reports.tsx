// Report channels (PLAN.md 5.21): what routines ask for and what agents report, shown as dated cards instead of a
// chat. People do not write here; a report is answered from its card, which opens the agent's own channel with the
// report attached to the next message. A card opens the whole report, with its images, over the page.
import {
  type Agent,
  type Channel,
  type Citation,
  type Job,
  type Message,
  type MessageImage,
  reportCode,
  reportTitle,
} from '@lonca/protocol';
import { Avatar, Button, Chip, Icon, IconButton, Spinner } from '@lonca/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { specialistIcon } from '../agents/SpecialistDialog';
import { core } from '../rpc';
import { useApp } from '../store';
import { clock, dayKey, dayLabel, elapsed, tokens } from './format';
import { Markdown } from './Markdown';

const EMPTY: Message[] = [];
const NO_AGENTS: Agent[] = [];

/** One card: what was asked (a routine's message), the job that worked on it, and the report it ended with. */
export interface ReportEntry {
  key: string;
  /** The report itself: the agent's answer, or a report it posted. */
  report?: Message;
  /** The message that asked for it (a routine's, usually). */
  request?: Message;
  job?: Job;
  /** What the agent wrote while it worked. */
  notes: Message[];
  agentId?: string;
  at: number;
}

/** Groups a report channel's messages into cards, newest first. */
export function reportEntries(messages: Message[], jobs: Record<string, Job>, channelId: string): ReportEntry[] {
  const byJob = new Map<string, ReportEntry>();
  const out: ReportEntry[] = [];
  const jobsOf = new Map<string, Job[]>();
  for (const j of Object.values(jobs)) {
    if (j.channelId !== channelId) continue;
    jobsOf.set(j.requestId, [...(jobsOf.get(j.requestId) ?? []), j]);
  }
  const entryFor = (jobId: string, at: number): ReportEntry => {
    let e = byJob.get(jobId);
    if (!e) {
      const job = jobs[jobId];
      e = { key: jobId, notes: [], at, ...(job ? { job, agentId: job.agentId } : {}) };
      byJob.set(jobId, e);
      out.push(e);
    }
    return e;
  };
  for (const m of messages) {
    if (m.author.kind === 'agent' && m.jobId) {
      const e = entryFor(m.jobId, m.created);
      e.report = m;
      e.agentId = m.author.id;
      e.at = Math.max(e.at, m.created);
      continue;
    }
    if (m.author.kind === 'agent' && m.during) {
      entryFor(m.during, m.created).notes.push(m);
      continue;
    }
    const started = (jobsOf.get(m.id) ?? []).sort((a, b) => a.started - b.started);
    if (started.length > 0) {
      for (const j of started) {
        const e = entryFor(j.id, m.created);
        e.request = m;
      }
      continue;
    }
    // A report an agent posted, or a request no agent has taken (yet).
    out.push({
      key: m.id,
      notes: [],
      at: m.created,
      ...(m.author.kind === 'agent' ? { report: m, agentId: m.author.id } : { request: m }),
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Markdown made into a short plain line for a card. */
function plain(text: string, title: string): string {
  return (
    text
      .replace(/```[\s\S]*?```/g, ' ')
      .split('\n')
      .filter((l) => !(l.trim().startsWith('#') && l.replace(/^#+\s*/, '').trim() === title))
      // A list item or a quote keeps its words, joined to the line before with a separator.
      .map((l) => (/^\s*([-*+>]|\d+[.)])\s+/.test(l) ? ` · ${l.replace(/^\s*([-*+>]|\d+[.)])\s+/, '')}` : l))
      .join(' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`#|]/g, '')
      .replace(/(^|[.:;])\s*·\s*/g, '$1 ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** One of a message's images, loaded the first time it is shown. */
export function Picture({ message, image, className }: { message: string; image: MessageImage; className?: string }) {
  const key = `${message}/${image.blob}`;
  const url = useApp((s) => s.pictures[key]);
  const loadPicture = useApp((s) => s.loadPicture);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (url) return;
    let live = true;
    void loadPicture(message, image.blob).then((u) => live && !u && setMissing(true));
    return () => {
      live = false;
    };
  }, [url, message, image.blob, loadPicture]);
  const { t } = useTranslation();
  if (missing)
    return (
      <span className={`${className ?? ''} pic is-missing`} title={t('reports.imageElsewhere')}>
        <Icon name="image" size={16} />
      </span>
    );
  return url ? (
    <img className={`${className ?? ''} pic`} src={url} alt={image.caption ?? ''} draggable={false} />
  ) : (
    <span className={`${className ?? ''} pic is-loading`} />
  );
}

/** A message's images as a row of thumbnails; a click shows them full size. */
export function MessageImages({ message, max = 6 }: { message: Message; max?: number }) {
  const { t } = useTranslation();
  const images = message.images ?? [];
  if (images.length === 0) return null;
  const shown = images.slice(0, max);
  const more = images.length - shown.length;
  return (
    <div className="pics">
      {shown.map((img, i) => (
        <button
          key={img.blob}
          type="button"
          className="pics__item"
          aria-label={img.caption || t('reports.image', { n: i + 1 })}
          title={img.caption}
          onClick={(e) => {
            e.stopPropagation();
            useApp.setState({ lightbox: { message: message.id, images, index: i } });
          }}
        >
          <Picture message={message.id} image={img} />
          {more > 0 && i === shown.length - 1 && <span className="pics__more">+{more}</span>}
        </button>
      ))}
    </div>
  );
}

/** The report a message answers, as a small object above its text; a click opens the report. */
export function CiteChip({ cite, onRemove }: { cite: Citation; onRemove?: () => void }) {
  const { t, i18n } = useTranslation();
  const when = new Date(cite.at).toLocaleString(i18n.language, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <span className="cite">
      <button type="button" className="cite__open" onClick={() => useApp.getState().openReport(cite.id)}>
        <span className="cite__icon">
          <Icon name="report" size={14} />
        </span>
        <span className="cite__text">
          <span className="cite__meta l-mono">
            #{reportCode(cite.id)} · {when} · {cite.by}
          </span>
          <b>{cite.title || t('reports.untitled')}</b>
        </span>
      </button>
      {onRemove && (
        <button type="button" className="cite__x" aria-label={t('reports.uncite')} onClick={onRemove}>
          <Icon name="close" size={11} />
        </button>
      )}
    </span>
  );
}

function stateOf(entry: ReportEntry): 'running' | 'attention' | 'done' | 'failed' | 'stopped' | 'waiting' | 'posted' {
  if (entry.job) return entry.job.state;
  return entry.report ? 'posted' : 'waiting';
}

function StatePill({ entry }: { entry: ReportEntry }) {
  const { t } = useTranslation();
  const state = stateOf(entry);
  return (
    <span className={`rstate rstate--${state}`}>
      {state === 'running' ? (
        <Spinner />
      ) : (
        <Icon
          name={
            state === 'done' || state === 'posted'
              ? 'check'
              : state === 'failed' || state === 'stopped'
                ? 'close'
                : state === 'attention'
                  ? 'alert'
                  : 'clock'
          }
          size={12}
        />
      )}
      {t(`reports.state.${state}`)}
    </span>
  );
}

function ReportCard({ entry, agent, onOpen }: { entry: ReportEntry; agent: Agent | undefined; onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  const answerReport = useApp((s) => s.answerReport);
  const report = entry.report;
  const title = report ? reportTitle(report, entry.request) : reportTitle({ text: '' }, entry.request);
  const summary = report ? plain(report.text, title) : '';
  const job = entry.job;
  const running = job?.state === 'running' || job?.state === 'attention';
  const step = running ? job?.steps.at(-1) : undefined;
  const name = agent?.name ?? (report?.author.kind === 'agent' ? report.author.name : '');
  const routine = entry.request?.routine !== undefined;
  return (
    <motion.article
      className={`rcard rcard--${stateOf(entry)}`}
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { type: 'spring', stiffness: 420, damping: 34 } }}
      onClick={(e) => {
        // A click anywhere on the card opens it, unless it was on one of its own buttons.
        if (!(e.target as HTMLElement).closest('button')) onOpen();
      }}
    >
      <span className="rcard__rail" aria-hidden="true" />
      <header className="rcard__head">
        <Avatar name={name} size={26} icon={agent?.specialty ? specialistIcon(agent) : 'terminal'} />
        <span className="rcard__who">
          <b>{name || t('reports.nobody')}</b>
          <span className="rcard__kind">
            <Icon name={routine ? 'clock' : 'report'} size={11} />
            {routine ? t('reports.fromRoutine') : report ? t('reports.posted') : t('reports.asked')}
          </span>
        </span>
        <span className="grow" />
        <time className="rcard__time l-mono" dateTime={new Date(entry.at).toISOString()}>
          {clock(entry.at)}
        </time>
      </header>
      <button type="button" className="rcard__title" onClick={onOpen}>
        {title || t('reports.untitled')}
      </button>
      {summary ? (
        <p className="rcard__sum">{summary}</p>
      ) : running ? (
        <p className="rcard__sum rcard__sum--step">
          {step
            ? `${t(`job.tool.${step.label}`, step.label)}${step.arg ? ` · ${step.arg}` : ''}`
            : t('reports.working')}
        </p>
      ) : null}
      {report && <MessageImages message={report} max={4} />}
      <footer className="rcard__foot">
        <StatePill entry={entry} />
        {report && <span className="rcard__code l-mono">#{reportCode(report.id)}</span>}
        {job?.ended && <span className="l-mono">{elapsed(job.started, job.ended)}</span>}
        {job && job.usage.in + job.usage.out > 0 && (
          <span className="l-mono" title={t('reports.tokens')}>
            {tokens(job.usage.in + job.usage.cached + job.usage.out, i18n.language)}
          </span>
        )}
        {(report?.images?.length ?? 0) > 0 && (
          <span className="rcard__count">
            <Icon name="image" size={12} />
            {report?.images?.length}
          </span>
        )}
        <span className="grow" />
        {report && report.author.kind === 'agent' && (
          <Button size="sm" variant="quiet" icon="reply" onClick={() => void answerReport(report, entry.request)}>
            {t('reports.answer')}
          </Button>
        )}
      </footer>
    </motion.article>
  );
}

export function ReportsView({ channel }: { channel: Channel }) {
  const { t, i18n } = useTranslation();
  const messages = useApp((s) => s.messages[channel.id] ?? EMPTY);
  const jobs = useApp((s) => s.jobs);
  const agents = useApp((s) => s.workspace?.agents ?? NO_AGENTS);
  const canEdit = useApp((s) => s.workspace?.kind === 'personal' || s.workspace?.role === 'admin');
  const [who, setWho] = useState<string>('all');
  const entries = useMemo(() => reportEntries(messages, jobs, channel.id), [messages, jobs, channel.id]);
  const writers = useMemo(() => [...new Set(entries.flatMap((e) => (e.agentId ? [e.agentId] : [])))], [entries]);
  const shown = who === 'all' ? entries : entries.filter((e) => e.agentId === who);
  const open = (e: ReportEntry) => {
    const id = e.report?.id ?? e.request?.id;
    if (id) useApp.getState().openReport(id);
  };

  return (
    <main className="chat reports-page">
      <header className="chat__head">
        <h2>
          <Icon name="report" size={15} />
          {channel.name}
        </h2>
        <Chip>{t('reports.kind')}</Chip>
        <span className="chat__topic">{t('reports.hint')}</span>
        <span className="grow" />
        <Button size="sm" variant="quiet" icon="clock" onClick={() => useApp.getState().setView('routines')}>
          {t('shell.routines')}
        </Button>
        {canEdit && (
          <IconButton
            icon="hash"
            label={t('reports.toText')}
            onClick={() => void useApp.getState().setReports(channel.id, false)}
          />
        )}
      </header>
      {writers.length > 1 && (
        <div className="reports__filter">
          <fieldset>
            <legend className="l-sr">{t('reports.filter')}</legend>
            {['all', ...writers].map((id) => (
              <label key={id} className="tile" data-checked={who === id || undefined}>
                <input
                  type="radio"
                  className="l-sr"
                  name="report-writer"
                  checked={who === id}
                  onChange={() => setWho(id)}
                />
                {id === 'all' ? t('reports.everyone') : `@${agents.find((a) => a.id === id)?.handle ?? '?'}`}
              </label>
            ))}
          </fieldset>
        </div>
      )}
      <div className="reports">
        {shown.length === 0 ? (
          <div className="empty">
            <span className="reports__emptyicon">
              <Icon name="report" size={30} />
            </span>
            <p className="empty__title">{t('reports.empty')}</p>
            <p className="empty__sub">{t('reports.emptyHint')}</p>
            <div className="empty__acts">
              <Button icon="clock" onClick={() => useApp.setState({ routineDialog: 'new' })}>
                {t('routines.new')}
              </Button>
            </div>
          </div>
        ) : (
          shown.map((e, i) => {
            const prev = shown[i - 1];
            const newDay = !prev || dayKey(prev.at) !== dayKey(e.at);
            return (
              <section key={e.key} className="reports__item">
                {newDay && (
                  <h3 className="reports__day">
                    <span>{dayLabel(e.at, i18n.language, t('channel.today'), t('channel.yesterday'))}</span>
                    <span className="reports__weekday">
                      {new Date(e.at).toLocaleDateString(i18n.language, { weekday: 'long' })}
                    </span>
                  </h3>
                )}
                <ReportCard entry={e} agent={agents.find((a) => a.id === e.agentId)} onOpen={() => open(e)} />
              </section>
            );
          })
        )}
      </div>
      <p className="reports__note">
        <Icon name="shield" size={13} />
        {t('reports.closed')}
      </p>
    </main>
  );
}

/** A report over the page: all of it, its images, the request and the job behind it. */
export function ReportDialog({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const close = useCallback(() => useApp.getState().openReport(undefined), []);
  const [data, setData] = useState<{ message: Message; jobs: Job[]; request?: Message; notes?: Message[] }>();
  const [failed, setFailed] = useState(false);
  // The store's copies are newer while a job runs; the fetched ones fill in what is not loaded.
  const live = useApp((s) => {
    const m = data?.message;
    return m?.jobId ? s.jobs[m.jobId] : data?.jobs[0] ? s.jobs[data.jobs[0].id] : undefined;
  });
  const agents = useApp((s) => s.workspace?.agents ?? NO_AGENTS);
  const answerReport = useApp((s) => s.answerReport);
  const lightbox = useApp((s) => s.lightbox);

  useEffect(() => {
    let on = true;
    core
      .call('messages.get', { id })
      .then((r) => on && setData(r))
      .catch(() => on && setFailed(true));
    return () => {
      on = false;
    };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !useApp.getState().lightbox && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const message = data?.message;
  // Opened from a request no job answered yet: the request is all there is.
  const report = message?.author.kind === 'agent' ? message : undefined;
  const request = data?.request ?? (report ? undefined : message);
  const job = live ?? data?.jobs[0];
  const agent = agents.find((a) => a.id === (report?.author.kind === 'agent' ? report.author.id : job?.agentId));
  const title = report ? reportTitle(report, request) : reportTitle({ text: '' }, request);
  const when = message
    ? new Date(message.created).toLocaleString(i18n.language, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
  // The answer's first heading is the card's title: shown once, above.
  const body = report?.text.replace(/^\s{0,3}#{1,3}\s+.+\n?/, '').trim();

  return (
    <motion.div
      className="l-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <motion.div
        className="l-dialog report"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 440, damping: 34 } }}
        exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
      >
        <header className="report__head">
          <Avatar name={agent?.name ?? ''} size={34} icon={agent?.specialty ? specialistIcon(agent) : 'terminal'} />
          <div className="report__who">
            <span className="report__meta l-mono">
              {message && `#${reportCode(message.id)}`}
              {agent && ` · @${agent.handle}`}
            </span>
            <h2 id="report-title">{failed ? t('reports.gone') : title || t('reports.untitled')}</h2>
            <span className="report__when">{when}</span>
          </div>
          <IconButton icon="close" label={t('common.close')} onClick={close} />
        </header>
        <div className="report__body">
          {!data && !failed && (
            <div className="report__loading">
              <Spinner />
            </div>
          )}
          {data && (
            <>
              <div className="report__facts">
                {job && <StatePill entry={{ key: job.id, job, notes: [], at: job.started }} />}
                {request?.routine && (
                  <span>
                    <Icon name="clock" size={12} />
                    {t('reports.fromRoutine')}
                  </span>
                )}
                {job?.ended && (
                  <span className="l-mono">
                    <Icon name="clock" size={12} />
                    {elapsed(job.started, job.ended)}
                  </span>
                )}
                {job && (
                  <span className="l-mono">
                    {t('job.usage', {
                      in: tokens(job.usage.in, i18n.language),
                      cached: tokens(job.usage.cached, i18n.language),
                      out: tokens(job.usage.out, i18n.language),
                    })}
                  </span>
                )}
                {job?.cost !== undefined && job.cost > 0 && <span className="l-mono">${job.cost.toFixed(2)}</span>}
              </div>
              {(report?.images?.length ?? 0) > 0 && report && (
                <div className="report__gallery">
                  {report.images?.map((img, i) => (
                    <figure key={img.blob}>
                      <button
                        type="button"
                        aria-label={img.caption || t('reports.image', { n: i + 1 })}
                        onClick={() =>
                          useApp.setState({ lightbox: { message: report.id, images: report.images ?? [], index: i } })
                        }
                      >
                        <Picture message={report.id} image={img} />
                      </button>
                      {img.caption && <figcaption>{img.caption}</figcaption>}
                    </figure>
                  ))}
                </div>
              )}
              {body ? (
                <Markdown text={body} />
              ) : (
                <p className="muted">
                  {job?.state === 'running' || job?.state === 'attention' ? t('reports.working') : t('reports.noText')}
                </p>
              )}
              {(data.notes?.length ?? 0) > 0 && (
                <details className="report__notes">
                  <summary>{t('reports.notes', { count: data.notes?.length ?? 0 })}</summary>
                  <ol>
                    {data.notes?.map((n) => (
                      <li key={n.id}>
                        <time className="l-mono">{clock(n.created)}</time>
                        <Markdown text={n.text} />
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {request && (
                <div className="report__ask">
                  <span className="report__label">{t('reports.request')}</span>
                  <p>{request.text}</p>
                </div>
              )}
            </>
          )}
        </div>
        <footer className="report__foot">
          {job && (
            <Button
              variant="quiet"
              icon="eye"
              onClick={() => {
                close();
                void useApp.getState().openJob(job.id);
              }}
            >
              {t('job.watch')}
            </Button>
          )}
          <span className="grow" />
          {report && (
            <Button variant="primary" icon="reply" onClick={() => void answerReport(report, request)}>
              {t('reports.answer')}
            </Button>
          )}
        </footer>
      </motion.div>
      <AnimatePresence>{lightbox && <Lightbox key="lightbox" />}</AnimatePresence>
    </motion.div>
  );
}

/** Images full size, one at a time: arrows or the keys step through them, Esc or a click outside closes. */
export function Lightbox() {
  const { t } = useTranslation();
  const box = useApp((s) => s.lightbox);
  const close = useCallback(() => useApp.setState({ lightbox: undefined }), []);
  const step = useCallback((by: number) => {
    const b = useApp.getState().lightbox;
    if (!b || b.images.length < 2) return;
    useApp.setState({ lightbox: { ...b, index: (b.index + by + b.images.length) % b.images.length } });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close, step]);
  const image = box?.images[box.index];
  if (!box || !image) return null;
  return (
    <motion.div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={image.caption || t('reports.image', { n: box.index + 1 })}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <IconButton className="lightbox__close" icon="close" label={t('common.close')} onClick={close} />
      {box.images.length > 1 && (
        <IconButton
          className="lightbox__prev"
          icon="chevronLeft"
          label={t('reports.previous')}
          onClick={() => step(-1)}
        />
      )}
      <motion.figure
        key={image.blob}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.16 }}
      >
        <Picture message={box.message} image={image} />
        <figcaption>
          {image.caption && <span>{image.caption}</span>}
          {box.images.length > 1 && (
            <span className="l-mono">
              {box.index + 1} / {box.images.length}
            </span>
          )}
        </figcaption>
      </motion.figure>
      {box.images.length > 1 && (
        <IconButton className="lightbox__next" icon="chevronRight" label={t('reports.next')} onClick={() => step(1)} />
      )}
    </motion.div>
  );
}
