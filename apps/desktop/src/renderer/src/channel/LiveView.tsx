// The whole transcript of one job, as it happens: every tool call with its result, the agent's text, steers.
import type { TranscriptEntry } from '@lonca/protocol';
import { Icon, IconButton, softSpring } from '@lonca/ui';
import { animate, usePresence, useReducedMotionConfig } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { core } from '../rpc';
import { useApp } from '../store';
import { clock } from './format';
import { Markdown } from './Markdown';

/**
 * The transform that lays the panel over its job's card, so the panel can grow out of the card and go back into
 * it. Undefined when the card is not in sight (another page, scrolled away): the panel then slides.
 */
function ontoCard(panel: HTMLElement, jobId: string) {
  const card = document.querySelector(`[data-job="${CSS.escape(jobId)}"]`);
  if (!card) return undefined;
  const a = panel.getBoundingClientRect();
  const b = card.getBoundingClientRect();
  if (a.width === 0 || a.height === 0 || b.width === 0 || b.bottom < 0 || b.top > window.innerHeight) return undefined;
  return { x: b.left - a.left, y: b.top - a.top, scaleX: b.width / a.width, scaleY: b.height / a.height };
}

/** `over`: drawn over the page instead of beside it (a window too narrow for both). */
export function LiveView({ jobId, over = false }: { jobId: string; over?: boolean }) {
  const { t } = useTranslation();
  const job = useApp((s) => s.jobs[jobId]);
  const agent = useApp((s) => s.workspace?.agents.find((a) => a.id === s.jobs[jobId]?.agentId));
  const watch = useApp((s) => s.watch);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const [present, safeToRemove] = usePresence();
  const reduced = useReducedMotionConfig();
  const version = `${job?.steps.length ?? 0}:${job?.state}:${job?.preview?.length ?? 0}`;

  useEffect(() => {
    let alive = true;
    void version;
    const t = setTimeout(() => {
      void core.call('jobs.transcript', { id: jobId }).then((e) => {
        if (alive) setEntries(e);
      });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [jobId, version]);

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  // The panel arrives from its job's card and leaves into it: the card is what it shows more of.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, when the panel is first laid out
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const from = reduced ? undefined : ontoCard(el, jobId);
    if (from) {
      animate(
        el,
        { x: [from.x, 0], y: [from.y, 0], scaleX: [from.scaleX, 1], scaleY: [from.scaleY, 1], opacity: [0.5, 1] },
        softSpring,
      );
      // What is in it would be squeezed on the way: it comes once the panel has its shape.
      animate([...el.children], { opacity: [0, 1] }, { delay: 0.12, duration: 0.2 });
    } else animate(el, reduced ? { opacity: [0, 1] } : { x: [24, 0], opacity: [0, 1] }, { duration: 0.2 });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only leaving matters here
  useEffect(() => {
    if (present) return;
    const el = root.current;
    const done = () => safeToRemove?.();
    if (!el) return done();
    const to = reduced ? undefined : ontoCard(el, jobId);
    if (to) {
      animate([...el.children], { opacity: 0 }, { duration: 0.08 });
      void animate(el, { ...to, opacity: 0.2 }, { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }).then(done);
    } else void animate(el, reduced ? { opacity: 0 } : { x: 24, opacity: 0 }, { duration: 0.15 }).then(done);
  }, [present]);

  return (
    <aside
      ref={root}
      className={`live ${over ? 'live--over' : ''}`}
      aria-label={t('job.live')}
      style={{ transformOrigin: '0 0' }}
    >
      <header className="live__head">
        <div>
          <b>{t('job.live')}</b>
          <span>
            {agent?.name} · {job ? t(`job.state.${job.state}`) : ''}
          </span>
        </div>
        <IconButton icon="close" label={t('common.close')} onClick={() => watch(undefined)} />
      </header>
      <div className="live__list l-selectable" ref={list}>
        {entries.length === 0 && <p className="muted">{t('job.noTranscript')}</p>}
        {entries.map((e, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a transcript only grows at the end, never reorders
          <div key={`${e.t}-${i}`} className={`entry entry--${e.t}`}>
            <time className="l-mono">{clock(e.at)}</time>
            {e.t === 'text' && <Markdown text={e.text} />}
            {e.t === 'tool' && (
              <span>
                <Icon name="chevronRight" size={12} /> {t(`job.tool.${e.label}`, e.label)}{' '}
                {e.arg && <code>{e.arg}</code>}
              </span>
            )}
            {e.t === 'result' && <pre className={e.ok ? '' : 'is-failed'}>{e.preview || '—'}</pre>}
            {e.t === 'steer' && (
              <span>
                {t('job.tool.steer')}: {e.text}
              </span>
            )}
            {e.t === 'denied' && (
              <span className="is-failed">
                {t('job.denied')} · {t(`job.tool.${e.label}`, e.label)} {e.arg && <code>{e.arg}</code>}
              </span>
            )}
            {e.t === 'notice' && <span>{t(`job.tool.${e.text}`, e.text)}</span>}
            {e.t === 'end' && (
              <span>{e.ok ? t('job.state.done') : t(`job.error.${e.error ?? 'failed'}`, e.error ?? '')}</span>
            )}
          </div>
        ))}
        {job?.preview && job.state === 'running' && <p className="entry entry--preview">{job.preview}</p>}
      </div>
    </aside>
  );
}
