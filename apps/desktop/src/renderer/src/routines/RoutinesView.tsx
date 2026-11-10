// Routines (PLAN.md 5.16): messages posted for a person at set times, as their standing request. The list shows
// everyone's; a routine is changed and run only by the person who made it, on whose computer it posts.
import type { RoutineView } from '@lonca/protocol';
import { Button, Chip, Icon, IconButton, Switch } from '@lonca/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorLine } from '../parts';
import { useApp } from '../store';

const NO_ROUTINES: RoutineView[] = [];
/** Monday first, as the week is written here. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

function dayName(day: number, lang: string, width: 'short' | 'long' = 'short'): string {
  // 2026-11-01 is a Sunday.
  return new Date(2026, 10, 1 + day).toLocaleDateString(lang, { weekday: width });
}

function when(ms: number, lang: string, today: string, tomorrow: string): string {
  const d = new Date(ms);
  const now = new Date();
  const time = d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return `${today} ${time}`;
  if (days === 1) return `${tomorrow} ${time}`;
  return `${d.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'short' })} ${time}`;
}

export function RoutineDialog() {
  const { t, i18n } = useTranslation();
  const target = useApp((s) => s.routineDialog);
  const workspace = useApp((s) => s.workspace);
  const channelId = useApp((s) => s.channelId);
  const saveRoutine = useApp((s) => s.saveRoutine);
  const close = useCallback(() => useApp.setState({ routineDialog: undefined }), []);
  const existing = target && target !== 'new' ? target : undefined;
  const channels = useMemo(() => workspace?.channels.filter((c) => c.kind === 'channel') ?? [], [workspace]);
  const [channel, setChannel] = useState(
    existing?.channelId ?? channels.find((c) => c.id === channelId)?.id ?? channels[0]?.id ?? '',
  );
  const [text, setText] = useState(existing?.text ?? '');
  const [at, setAt] = useState(existing?.at ?? '09:00');
  const [days, setDays] = useState<number[]>(existing?.days ?? []);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  if (!target) return null;
  const agents = workspace?.agents ?? [];
  const title = existing ? t('routines.edit') : t('routines.new');
  return (
    <motion.div
      className="l-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <motion.form
        className="l-dialog agentform wsform"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 460, damping: 34 } }}
        exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const ok = await saveRoutine({
            ...(existing ? { id: existing.id } : {}),
            channelId: channel,
            text,
            at,
            days,
            enabled: existing?.enabled ?? true,
          });
          setBusy(false);
          if (ok) close();
        }}
      >
        <header className="agentform__head">
          <h2>{title}</h2>
          <IconButton icon="close" label={t('common.close')} onClick={close} />
        </header>
        <div className="agentform__body">
          <p className="muted">{t('routines.intro')}</p>
          <div className="l-field">
            <label className="l-field__label" htmlFor="routine-text">
              {t('routines.text')}
            </label>
            <textarea
              id="routine-text"
              ref={box}
              className="l-input agentform__text"
              value={text}
              maxLength={4000}
              required
              // biome-ignore lint/a11y/noAutofocus: the dialog opens to have the message written
              autoFocus
              placeholder={t('routines.textPlaceholder')}
              onChange={(e) => setText(e.target.value)}
            />
            {agents.length > 0 && (
              <div className="routine__handles">
                {agents.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="tile"
                    title={a.specialty?.role ?? a.name}
                    onClick={() => {
                      setText((v) => (v.includes(`@${a.handle}`) ? v : `@${a.handle} ${v}`));
                      // Writing goes on after the mention.
                      requestAnimationFrame(() => {
                        const el = box.current;
                        if (!el) return;
                        el.focus();
                        el.setSelectionRange(el.value.length, el.value.length);
                      });
                    }}
                  >
                    @{a.handle}
                  </button>
                ))}
              </div>
            )}
            <span className="l-field__hint">{t('routines.textHint')}</span>
          </div>
          <div className="agentform__pair">
            <div className="l-field">
              <label className="l-field__label" htmlFor="routine-at">
                {t('routines.at')}
              </label>
              <input
                id="routine-at"
                type="time"
                className="l-input l-mono"
                value={at}
                required
                onChange={(e) => setAt(e.target.value)}
              />
            </div>
            <div className="l-field">
              <label className="l-field__label" htmlFor="routine-channel">
                {t('routines.channel')}
              </label>
              <select
                id="routine-channel"
                className="l-input"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <fieldset className="l-field routine__days">
            <legend className="l-field__label">{t('routines.days')}</legend>
            <div className="daypick">
              {WEEK.map((d) => {
                const on = days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    className={`daypick__day ${on ? 'is-on' : ''}`}
                    aria-pressed={on}
                    aria-label={dayName(d, i18n.language, 'long')}
                    onClick={() => setDays((list) => (on ? list.filter((x) => x !== d) : [...list, d]))}
                  >
                    {dayName(d, i18n.language)}
                  </button>
                );
              })}
            </div>
            <span className="l-field__hint">
              {days.length === 0 || days.length === 7 ? t('routines.everyDay') : t('routines.someDays')}
            </span>
          </fieldset>
          <ErrorLine />
        </div>
        <footer className="agentform__foot">
          <span className="grow" />
          <Button variant="quiet" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!text.trim() || !channel || !at}>
            {t('agentForm.save')}
          </Button>
        </footer>
      </motion.form>
    </motion.div>
  );
}

function RoutineCard({ routine }: { routine: RoutineView }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const workspace = useApp((s) => s.workspace);
  const saveRoutine = useApp((s) => s.saveRoutine);
  const deleteRoutine = useApp((s) => s.deleteRoutine);
  const runRoutine = useApp((s) => s.runRoutine);
  const [ran, setRan] = useState(false);
  const channel = workspace?.channels.find((c) => c.id === routine.channelId);
  const mine = routine.owner === workspace?.me.id;
  const owner = workspace?.members?.find((m) => m.device === routine.owner)?.name;
  const everyDay = routine.days.length === 0 || routine.days.length === 7;
  return (
    <motion.li
      className={`routine ${routine.enabled ? '' : 'is-off'}`}
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
    >
      <div className="routine__time">
        <b className="l-mono">{routine.at}</b>
        <span>
          {everyDay
            ? t('routines.daily')
            : WEEK.filter((d) => routine.days.includes(d))
                .map((d) => dayName(d, lang))
                .join(' ')}
        </span>
      </div>
      <div className="routine__body">
        <p className="routine__text">{routine.text}</p>
        <div className="routine__meta">
          <Chip mono>#{channel?.name ?? '—'}</Chip>
          {!mine && owner && <Chip>{t('routines.owner', { name: owner })}</Chip>}
          {routine.enabled && routine.next && (
            <span>
              <Icon name="clock" size={12} />
              {t('routines.next', { when: when(routine.next, lang, t('channel.today'), t('routines.tomorrow')) })}
            </span>
          )}
          {routine.last && (
            <span>
              {t('routines.last', { when: when(routine.last, lang, t('channel.today'), t('routines.tomorrow')) })}
            </span>
          )}
          {!routine.enabled && <span>{t('routines.off')}</span>}
        </div>
      </div>
      {mine && (
        <div className="routine__acts">
          <Button
            size="sm"
            icon={ran ? 'check' : 'bolt'}
            onClick={async () => {
              if (await runRoutine(routine.id)) setRan(true);
            }}
          >
            {ran ? t('routines.ran') : t('routines.run')}
          </Button>
          <IconButton
            size="sm"
            icon="pencil"
            label={t('routines.edit')}
            onClick={() => useApp.setState({ routineDialog: routine, error: undefined })}
          />
          <IconButton
            size="sm"
            icon="trash"
            label={t('routines.delete')}
            onClick={() => void deleteRoutine(routine.id)}
          />
          <Switch
            checked={routine.enabled}
            label={t('routines.enabled')}
            onChange={(enabled) =>
              void saveRoutine({
                id: routine.id,
                channelId: routine.channelId,
                text: routine.text,
                at: routine.at,
                days: routine.days,
                enabled,
              })
            }
          />
        </div>
      )}
    </motion.li>
  );
}

export function RoutinesView() {
  const { t } = useTranslation();
  const routines = useApp((s) => s.workspace?.routines ?? NO_ROUTINES);
  const viewer = useApp((s) => s.workspace?.role === 'viewer');
  const open = () => useApp.setState({ routineDialog: 'new', error: undefined });
  const sorted = useMemo(() => [...routines].sort((a, b) => a.at.localeCompare(b.at)), [routines]);
  return (
    <main className="chat">
      <header className="chat__head">
        <h2>
          <Icon name="clock" size={15} />
          {t('shell.routines')}
        </h2>
        <span className="chat__topic">{t('routines.topic')}</span>
        <span className="grow" />
        {!viewer && (
          <Button size="sm" icon="plus" onClick={open}>
            {t('routines.new')}
          </Button>
        )}
      </header>
      {sorted.length === 0 ? (
        <section className="empty">
          <span className="empty__icon">
            <Icon name="clock" size={22} />
          </span>
          <p className="empty__title">{t('shell.empty.routines')}</p>
          <p className="empty__sub routines__why">{t('routines.intro')}</p>
          {!viewer && (
            <Button variant="primary" icon="plus" onClick={open}>
              {t('routines.new')}
            </Button>
          )}
        </section>
      ) : (
        <ul className="routines">
          <AnimatePresence initial={false}>
            {sorted.map((r) => (
              <RoutineCard key={r.id} routine={r} />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </main>
  );
}
