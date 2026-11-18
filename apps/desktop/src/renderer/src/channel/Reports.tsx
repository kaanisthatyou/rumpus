// Reports (PLAN.md 5.21): what routines ask for and what agents report, on the board's Reports page as dated cards
// instead of a chat. People do not write there; a report is answered from its card, which opens the agent's own
// channel with the report attached to the next message, or its questions are decided from the report itself. A
// report is read once opened, and pinned ones stay at the top. A card opens the whole report over the page.
import {
  type Agent,
  type Citation,
  type Job,
  type Message,
  type MessageImage,
  type ReportMark,
  reportCode,
  reportTitle,
} from '@lonca/protocol';
import { Avatar, Button, Icon, IconButton, Spinner } from '@lonca/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { specialistIcon } from '../agents/SpecialistDialog';
import { EfficiencyMeter } from '../overview/Meter';
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

/** Groups the report feed's messages into cards, newest first. */
export function reportEntries(messages: Message[], jobs: Record<string, Job>): ReportEntry[] {
  const byJob = new Map<string, ReportEntry>();
  const out: ReportEntry[] = [];
  const asked = new Set(messages.map((m) => m.id));
  const jobsOf = new Map<string, Job[]>();
  for (const j of Object.values(jobs)) {
    if (!asked.has(j.requestId)) continue;
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
  // Asked again when images arrive from another member's computer.
  const epoch = useApp((s) => s.imagesEpoch);
  const [missing, setMissing] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the epoch is the trigger to ask again
  useEffect(() => {
    if (url) return;
    let live = true;
    void loadPicture(message, image.blob).then((u) => live && setMissing(!u));
    return () => {
      live = false;
    };
  }, [url, message, image.blob, loadPicture, epoch]);
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

/** The pin of a report: a click keeps it at the top of the page; pinned, it turns green. */
function PinButton({ id, pinned }: { id: string; pinned: boolean }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={`rpin ${pinned ? 'is-pinned' : ''}`}
      aria-pressed={pinned}
      aria-label={t(pinned ? 'reports.unpin' : 'reports.pin')}
      title={t(pinned ? 'reports.unpin' : 'reports.pin')}
      onClick={(e) => {
        e.stopPropagation();
        void useApp.getState().markReports([id], { pinned: !pinned });
      }}
    >
      <Icon name="pin" size={14} />
    </button>
  );
}

function ReportCard({
  entry,
  agent,
  mark,
  onOpen,
}: {
  entry: ReportEntry;
  agent: Agent | undefined;
  mark: ReportMark | undefined;
  onOpen: () => void;
}) {
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
  const unread = Boolean(report && !mark?.read);
  const asks = report?.decisions?.length ?? 0;
  return (
    <motion.article
      className={`rcard rcard--${stateOf(entry)} ${unread ? 'is-unread' : ''} ${mark?.pinned ? 'is-pinned' : ''}`}
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
        {report && <PinButton id={report.id} pinned={Boolean(mark?.pinned)} />}
      </header>
      <button type="button" className="rcard__title" onClick={onOpen}>
        {unread && <span className="rcard__new" title={t('reports.unread')} />}
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
      {asks > 0 && (
        <button type="button" className="rcard__asks" onClick={onOpen}>
          <Icon name="alert" size={12} />
          {t('reports.decisions.waiting', { count: asks })}
        </button>
      )}
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

type Filter = 'all' | 'unread' | 'pinned' | 'asks';

/** The board's Reports page: every report of the workspace as dated cards, the pinned ones first. */
export function ReportsView() {
  const { t, i18n } = useTranslation();
  const feed = useApp((s) => s.reportFeed);
  const wsId = useApp((s) => s.workspace?.id);
  const jobs = useApp((s) => s.jobs);
  const agents = useApp((s) => s.workspace?.agents ?? NO_AGENTS);
  const unreadCount = useApp((s) => s.workspace?.reportsUnread ?? 0);
  const overview = useApp((s) => s.overview);
  const [who, setWho] = useState<string>('all');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    void useApp.getState().loadReports();
    core
      .call('overview.get')
      .then((o) => useApp.setState({ overview: o }))
      .catch(() => {});
  }, []);

  const loaded = feed.ws === wsId;
  const messages = loaded ? feed.messages : EMPTY;
  const entries = useMemo(() => reportEntries(messages, jobs), [messages, jobs]);
  const writers = useMemo(() => [...new Set(entries.flatMap((e) => (e.agentId ? [e.agentId] : [])))], [entries]);
  const markOf = (e: ReportEntry) => (e.report ? feed.marks[e.report.id] : undefined);
  const counts = {
    unread: entries.filter((e) => e.report && !markOf(e)?.read).length,
    pinned: entries.filter((e) => markOf(e)?.pinned).length,
    asks: entries.filter((e) => (e.report?.decisions?.length ?? 0) > 0).length,
  };
  const byWho = who === 'all' ? entries : entries.filter((e) => e.agentId === who);
  const shown = byWho.filter((e) =>
    filter === 'unread'
      ? e.report && !markOf(e)?.read
      : filter === 'pinned'
        ? markOf(e)?.pinned
        : filter === 'asks'
          ? (e.report?.decisions?.length ?? 0) > 0
          : true,
  );
  // On the whole list the pinned ones stand above the days.
  const pinned = filter === 'all' ? shown.filter((e) => markOf(e)?.pinned) : [];
  const rest = filter === 'all' ? shown.filter((e) => !markOf(e)?.pinned) : shown;
  const open = (e: ReportEntry) => {
    const id = e.report?.id ?? e.request?.id;
    if (id) useApp.getState().openReport(id);
  };
  const card = (e: ReportEntry) => (
    <ReportCard entry={e} agent={agents.find((a) => a.id === e.agentId)} mark={markOf(e)} onOpen={() => open(e)} />
  );
  const weekReports = entries.filter((e) => e.report && e.at > Date.now() - 7 * 86_400_000).length;

  return (
    <main className="chat reports-page">
      <header className="chat__head">
        <h2>
          <Icon name="report" size={15} />
          {t('shell.reports')}
        </h2>
        <span className="chat__topic">{t('reports.hint')}</span>
        <span className="grow" />
        {unreadCount > 0 && (
          <Button
            size="sm"
            variant="quiet"
            icon="check"
            onClick={() => void useApp.getState().markReports(undefined, {})}
          >
            {t('reports.readAll')}
          </Button>
        )}
        <Button size="sm" variant="quiet" icon="clock" onClick={() => useApp.getState().setView('routines')}>
          {t('shell.routines')}
        </Button>
      </header>
      <div className="reports">
        <section className="rtop" aria-label={t('overview.efficiency.title')}>
          <EfficiencyMeter week={overview?.week} size={150} />
          <div className="rtop__facts">
            <div>
              <span className="stat__label">{t('reports.facts.week')}</span>
              <b className="l-mono">{weekReports}</b>
            </div>
            <div>
              <span className="stat__label">{t('reports.facts.unread')}</span>
              <b className="l-mono">{counts.unread}</b>
            </div>
            <div>
              <span className="stat__label">{t('reports.facts.asks')}</span>
              <b className="l-mono">{counts.asks}</b>
            </div>
            <div>
              <span className="stat__label">{t('reports.facts.pinned')}</span>
              <b className="l-mono">{counts.pinned}</b>
            </div>
          </div>
        </section>
        <div className="reports__filter">
          <fieldset>
            <legend className="l-sr">{t('reports.show')}</legend>
            {(['all', 'unread', 'pinned', 'asks'] as const).map((f) => (
              <label key={f} className="tile" data-checked={filter === f || undefined}>
                <input
                  type="radio"
                  className="l-sr"
                  name="report-filter"
                  checked={filter === f}
                  onChange={() => setFilter(f)}
                />
                {t(`reports.filters.${f}`)}
                {f !== 'all' && counts[f] > 0 && <span className="reports__n l-mono">{counts[f]}</span>}
              </label>
            ))}
          </fieldset>
          {writers.length > 1 && (
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
          )}
        </div>
        {!loaded ? (
          <div className="report__loading">
            <Spinner />
          </div>
        ) : shown.length === 0 ? (
          <div className="empty">
            <span className="reports__emptyicon">
              <Icon name="report" size={30} />
            </span>
            <p className="empty__title">{t(filter === 'all' ? 'reports.empty' : 'reports.emptyFilter')}</p>
            {filter === 'all' && <p className="empty__sub">{t('reports.emptyHint')}</p>}
            {filter === 'all' && (
              <div className="empty__acts">
                <Button icon="clock" onClick={() => useApp.setState({ routineDialog: 'new' })}>
                  {t('routines.new')}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <section className="reports__item">
                <h3 className="reports__day reports__day--pinned">
                  <Icon name="pin" size={13} />
                  <span>{t('reports.pinned')}</span>
                </h3>
                <div className="reports__grid">
                  {pinned.map((e) => (
                    <div key={e.key}>{card(e)}</div>
                  ))}
                </div>
              </section>
            )}
            {groupByDay(rest).map((g) => (
              <section key={g.key} className="reports__item">
                <h3 className="reports__day">
                  <span>{dayLabel(g.at, i18n.language, t('channel.today'), t('channel.yesterday'))}</span>
                  <span className="reports__weekday">
                    {new Date(g.at).toLocaleDateString(i18n.language, { weekday: 'long' })}
                  </span>
                </h3>
                <div className="reports__grid">
                  {g.entries.map((e) => (
                    <div key={e.key}>{card(e)}</div>
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
      <p className="reports__note">
        <Icon name="shield" size={13} />
        {t('reports.closed')}
      </p>
    </main>
  );
}

function groupByDay(entries: ReportEntry[]): { key: string; at: number; entries: ReportEntry[] }[] {
  const out: { key: string; at: number; entries: ReportEntry[] }[] = [];
  for (const e of entries) {
    const key = dayKey(e.at);
    const last = out.at(-1);
    if (last?.key === key) last.entries.push(e);
    else out.push({ key, at: e.at, entries: [e] });
  }
  return out;
}

/** What is chosen for one question: one of its options, the agent's call, or words of the person's own. */
type Choice = { kind: 'option'; text: string } | { kind: 'agent' } | { kind: 'own'; text: string };

/**
 * The questions a report leaves to the person: each answered with one of its options, with words of their own, or
 * left to the agent ("Senin kararın"). The answers go to the agent's own channel as the person's message, with the
 * report attached; anything else is answered with "Yanıtla", in the person's own words.
 */
function Decisions({ report, request }: { report: Message; request: Message | undefined }) {
  const { t } = useTranslation();
  const decisions = report.decisions ?? [];
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [busy, setBusy] = useState(false);
  const answered = Object.keys(choices).filter((k) => {
    const c = choices[Number(k)];
    return c && (c.kind !== 'own' || c.text.trim());
  }).length;
  const choose = (i: number, c: Choice | undefined) =>
    setChoices((all) => {
      const { [i]: _was, ...rest } = all;
      return c ? { ...rest, [i]: c } : rest;
    });
  const send = async () => {
    const lines = decisions.flatMap((d, i) => {
      const c = choices[i];
      if (!c || (c.kind === 'own' && !c.text.trim())) return [];
      const answer = c.kind === 'agent' ? t('reports.said.yours') : c.text.trim();
      return [`${i + 1}. ${d.question}\n   → ${answer}`];
    });
    if (lines.length === 0) return;
    setBusy(true);
    const ok = await useApp
      .getState()
      .answerReport(report, request, `${t('reports.said.decisions')}\n${lines.join('\n')}`);
    setBusy(false);
    if (ok) setChoices({});
  };
  return (
    <section className="decide" aria-labelledby="decide-title">
      <header className="decide__head">
        <Icon name="alert" size={14} />
        <h3 id="decide-title">{t('reports.decisions.title')}</h3>
        <span className="decide__n l-mono">
          {answered} / {decisions.length}
        </span>
      </header>
      <ol className="decide__list">
        {decisions.map((d, i) => {
          const c = choices[i];
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a report's questions never change order
            <li key={i} className={`decide__q ${c ? 'is-answered' : ''}`}>
              <p className="decide__text">{d.question}</p>
              <div className="decide__opts">
                {(d.options ?? []).map((o) => {
                  const on = c?.kind === 'option' && c.text === o;
                  return (
                    <button
                      key={o}
                      type="button"
                      className={`decide__opt ${on ? 'is-on' : ''}`}
                      aria-pressed={on}
                      onClick={() => choose(i, on ? undefined : { kind: 'option', text: o })}
                    >
                      {o}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={`decide__opt decide__opt--agent ${c?.kind === 'agent' ? 'is-on' : ''}`}
                  aria-pressed={c?.kind === 'agent'}
                  onClick={() => choose(i, c?.kind === 'agent' ? undefined : { kind: 'agent' })}
                >
                  <Icon name="spark" size={12} />
                  {t('reports.said.yours')}
                </button>
                <button
                  type="button"
                  className={`decide__opt decide__opt--own ${c?.kind === 'own' ? 'is-on' : ''}`}
                  aria-pressed={c?.kind === 'own'}
                  onClick={() => choose(i, c?.kind === 'own' ? undefined : { kind: 'own', text: '' })}
                >
                  <Icon name="pencil" size={12} />
                  {t('reports.decisions.own')}
                </button>
              </div>
              {c?.kind === 'own' && (
                <input
                  className="l-input decide__input"
                  // biome-ignore lint/a11y/noAutofocus: the field opens on request, typing is the next step
                  autoFocus
                  value={c.text}
                  maxLength={600}
                  aria-label={t('reports.decisions.ownLabel', { n: i + 1 })}
                  placeholder={t('reports.decisions.ownPlaceholder')}
                  onChange={(e) => choose(i, { kind: 'own', text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void send();
                  }}
                />
              )}
            </li>
          );
        })}
      </ol>
      <footer className="decide__foot">
        <span className="decide__hint">{t('reports.decisions.hint')}</span>
        <Button
          variant="primary"
          size="sm"
          icon="send"
          busy={busy}
          disabled={answered === 0}
          onClick={() => void send()}
        >
          {t('reports.decisions.send', { count: answered })}
        </Button>
      </footer>
    </section>
  );
}

/** A report over the page: all of it, its images, its questions, the request and the job behind it. */
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
  const mark = useApp((s) => s.reportFeed.marks[id]);

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
          {report && <PinButton id={report.id} pinned={Boolean(mark?.pinned)} />}
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
              {report && (report.decisions?.length ?? 0) > 0 && <Decisions report={report} request={request} />}
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
          {report && (
            <Button
              variant="quiet"
              icon="check"
              onClick={() => void useApp.getState().markReports([report.id], { read: !mark?.read })}
            >
              {t(mark?.read ? 'reports.markUnread' : 'reports.markRead')}
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
