// The whole transcript of one job, as it happens: every tool call with its result, the agent's text, steers.
import type { TranscriptEntry } from '@lonca/protocol';
import { Icon, IconButton } from '@lonca/ui';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { core } from '../rpc';
import { useApp } from '../store';
import { clock } from './format';
import { Markdown } from './Markdown';

/** `over`: drawn over the page instead of beside it (a window too narrow for both). */
export function LiveView({ jobId, over = false }: { jobId: string; over?: boolean }) {
  const { t } = useTranslation();
  const job = useApp((s) => s.jobs[jobId]);
  const agent = useApp((s) => s.workspace?.agents.find((a) => a.id === s.jobs[jobId]?.agentId));
  const watch = useApp((s) => s.watch);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const list = useRef<HTMLDivElement>(null);
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

  return (
    <motion.aside
      className={`live ${over ? 'live--over' : ''}`}
      aria-label={t('job.live')}
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
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
    </motion.aside>
  );
}
