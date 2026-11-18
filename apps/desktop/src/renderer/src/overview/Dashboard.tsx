// The Overview's numbers (PLAN.md 5.21): tokens over the last week (per day, and where they went), the efficiency
// meter, today's figures, and the agents whose jobs used the tokens. One series per chart, so no legend boxes;
// the split of the tokens names each part with its number beside its color.
import type { Overview } from '@lonca/protocol';
import { Icon } from '@lonca/ui';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { elapsed, tokens } from '../channel/format';
import { EfficiencyMeter } from './Meter';

const rise = { hidden: { opacity: 0, y: 8 }, shown: { opacity: 1, y: 0 } };

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <b className="stat__value">{value}</b>
      {note && <span className="stat__note">{note}</span>}
    </div>
  );
}

const totalOf = (d: Overview['days'][number]) => d.usage.in + d.usage.cached + d.usage.out;

/** Tokens per day over the last week: one series; each bar tells its day on hover and focus. */
function TokenWeek({ days }: { days: Overview['days'] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const most = Math.max(1, ...days.map(totalOf));
  const [at, setAt] = useState<number>();
  const shown = at === undefined ? undefined : days[at];
  return (
    <div className="tweek">
      <div className="tweek__tip l-mono" role="status">
        {shown
          ? [
              new Date(`${shown.day}T12:00:00`).toLocaleDateString(lang, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              }),
              `${tokens(totalOf(shown), lang)} token`,
              t('overview.jobs', { count: shown.jobs }),
              ...(shown.cost > 0 ? [`$${shown.cost.toFixed(2)}`] : []),
            ].join(' · ')
          : t('overview.dash.hover')}
      </div>
      <div className="tweek__bars">
        {days.map((d, i) => {
          const date = new Date(`${d.day}T12:00:00`);
          const n = totalOf(d);
          return (
            <button
              key={d.day}
              type="button"
              className={`tweek__day ${i === days.length - 1 ? 'is-today' : ''} ${at === i ? 'is-at' : ''}`}
              aria-label={`${date.toLocaleDateString(lang, { weekday: 'long' })}: ${tokens(n, lang)} token, ${t('overview.jobs', { count: d.jobs })}`}
              onMouseEnter={() => setAt(i)}
              onMouseLeave={() => setAt(undefined)}
              onFocus={() => setAt(i)}
              onBlur={() => setAt(undefined)}
            >
              <span className="tweek__value l-mono">{n > 0 ? tokens(n, lang) : ''}</span>
              <span className="tweek__track">
                <motion.span
                  className="tweek__bar"
                  initial={{ height: 0 }}
                  animate={{ height: n === 0 ? 2 : `${Math.max(6, (n / most) * 100)}%` }}
                  transition={{ type: 'spring', stiffness: 240, damping: 28, delay: i * 0.035 }}
                  data-empty={n === 0 || undefined}
                />
              </span>
              <span className="tweek__name">{date.toLocaleDateString(lang, { weekday: 'short' })}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Where the week's tokens went: input, cache reads and output, each named with its number beside its color. */
function TokenSplit({ usage }: { usage: Overview['week']['usage'] }) {
  const { t, i18n } = useTranslation();
  const all = usage.in + usage.cached + usage.out;
  const parts = [
    { key: 'in', n: usage.in },
    { key: 'cached', n: usage.cached },
    { key: 'out', n: usage.out },
  ] as const;
  return (
    <div className="tsplit">
      <div className="tsplit__bar" aria-hidden="true">
        {all > 0 &&
          parts.map((p) =>
            p.n > 0 ? (
              <motion.span
                key={p.key}
                className={`tsplit__part tsplit__part--${p.key}`}
                initial={{ flexGrow: 0 }}
                animate={{ flexGrow: p.n / all }}
                transition={{ type: 'spring', stiffness: 200, damping: 30 }}
              />
            ) : null,
          )}
      </div>
      <ul className="tsplit__legend">
        {parts.map((p) => (
          <li key={p.key}>
            <span className={`tsplit__dot tsplit__dot--${p.key}`} aria-hidden="true" />
            <span className="tsplit__name">{t(`overview.dash.${p.key}`)}</span>
            <b className="l-mono">{tokens(p.n, i18n.language)}</b>
            <span className="tsplit__share l-mono">{all > 0 ? `${Math.round((p.n / all) * 100)}%` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The last week by agent: whose jobs used the tokens, and how many of them were completed. */
function AgentShare({ agents }: { agents: Overview['agents'] }) {
  const { t, i18n } = useTranslation();
  const most = Math.max(1, ...agents.map((a) => a.tokens));
  return (
    <ul className="ashare">
      {agents.map((a, i) => (
        <li key={a.agentId}>
          <span className="ashare__name">
            <b>{a.name || '—'}</b>
            <span className="l-mono">{t('overview.dash.doneOf', { done: a.done, count: a.jobs })}</span>
          </span>
          <span className="ashare__track" aria-hidden="true">
            <motion.span
              className="ashare__bar"
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(2, (a.tokens / most) * 100)}%` }}
              transition={{ type: 'spring', stiffness: 220, damping: 30, delay: i * 0.04 }}
            />
          </span>
          <b className="ashare__n l-mono">{tokens(a.tokens, i18n.language)}</b>
        </li>
      ))}
    </ul>
  );
}

export function Dashboard({ overview }: { overview: Overview | undefined }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const today = overview?.today;
  const week = overview?.week;
  const weekTokens = week ? week.usage.in + week.usage.cached + week.usage.out : 0;
  const todayTokens = today ? today.usage.in + today.usage.cached + today.usage.out : 0;
  const ended = week ? week.done + week.failed + week.stopped : 0;
  const average = ended > 0 && week ? week.busyMs / ended : 0;
  return (
    <>
      <motion.section className="dash" variants={rise} aria-label={t('overview.week')}>
        <div className="dash__card dash__tokens">
          <header className="dash__head">
            <span className="stat__label">{t('overview.dash.tokens')}</span>
            <span className="dash__chip l-mono">{t('overview.week')}</span>
          </header>
          <div className="dash__hero">
            <b className="dash__big l-mono">{tokens(weekTokens, lang)}</b>
            <span className="dash__heronote">
              {t('overview.dash.today', { count: tokens(todayTokens, lang) })}
              {week && week.cost > 0 ? ` · $${week.cost.toFixed(2)}` : ''}
            </span>
          </div>
          {overview && <TokenWeek days={overview.days} />}
          {week && <TokenSplit usage={week.usage} />}
        </div>
        <div className="dash__card dash__eff">
          <header className="dash__head">
            <span className="stat__label">{t('overview.efficiency.title')}</span>
            <span className="dash__chip l-mono">{t('overview.week')}</span>
          </header>
          <EfficiencyMeter week={week} />
          <ul className="dash__ends">
            <li className="is-done">
              <Icon name="check" size={12} />
              <span>{t('overview.dash.done')}</span>
              <b className="l-mono">{week?.done ?? 0}</b>
            </li>
            <li className="is-failed">
              <Icon name="close" size={12} />
              <span>{t('overview.dash.failed')}</span>
              <b className="l-mono">{week?.failed ?? 0}</b>
            </li>
            <li className="is-stopped">
              <Icon name="alert" size={12} />
              <span>{t('overview.dash.stopped')}</span>
              <b className="l-mono">{week?.stopped ?? 0}</b>
            </li>
          </ul>
        </div>
      </motion.section>
      <motion.section className="home__stats" variants={rise} aria-label={t('overview.today')}>
        <Stat
          label={t('overview.stat.jobs')}
          value={String(today?.jobs ?? 0)}
          note={
            today?.failed
              ? t('overview.stat.failed', { count: today.failed })
              : t('overview.dash.weekJobs', { count: week?.jobs ?? 0 })
          }
        />
        <Stat
          label={t('overview.stat.tokens')}
          value={tokens((today?.usage.in ?? 0) + (today?.usage.out ?? 0), lang)}
          note={t('overview.stat.cached', { count: tokens(today?.usage.cached ?? 0, lang) })}
        />
        <Stat
          label={t('overview.stat.cost')}
          value={`$${(today?.cost ?? 0).toFixed(2)}`}
          note={t('overview.dash.weekCost', { cost: `$${(week?.cost ?? 0).toFixed(2)}` })}
        />
        <Stat
          label={t('overview.dash.average')}
          value={ended > 0 ? elapsed(0, average) : '—'}
          note={t('overview.dash.averageNote')}
        />
        <Stat label={t('overview.stat.messages')} value={String(today?.messages ?? 0)} />
      </motion.section>
      {(overview?.agents.length ?? 0) > 0 && (
        <motion.section className="panel" variants={rise}>
          <h3>{t('overview.dash.agents')}</h3>
          <AgentShare agents={overview?.agents ?? []} />
        </motion.section>
      )}
    </>
  );
}
