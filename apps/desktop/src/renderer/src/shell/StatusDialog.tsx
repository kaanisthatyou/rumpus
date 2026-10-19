// `/durum` (PLAN.md 5.5): every computer's CLIs, extra logins and quota, this one first. Other members' computers
// answer over the team link; their answers arrive one by one.
import type { DeviceStatus } from '@lonca/protocol';
import { Avatar, Chip, IconButton, Track } from '@lonca/ui';
import { motion } from 'motion/react';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../store';

const tone = (state: string) =>
  state === 'ready' ? 'ok' : state === 'signed-out' || state === 'needs-key' ? 'warn' : undefined;

function Device({ s }: { s: DeviceStatus }) {
  const { t } = useTranslation();
  return (
    <motion.section
      className="status__device l-card"
      aria-label={s.name}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <header className="status__head">
        <Avatar name={s.name} size={28} presence="on" />
        <b className="grow">
          {s.name}
          {s.me && <span className="muted"> · {t('status.thisComputer')}</span>}
        </b>
        {!s.me && <span className="muted l-mono">{new Date(s.at).toLocaleTimeString()}</span>}
      </header>
      {s.clis.length === 0 && s.accounts.length === 0 ? (
        <p className="muted">{t('status.noClis')}</p>
      ) : (
        <ul className="status__rows">
          {s.clis.map((c) => (
            <li key={c.kind}>
              <span className="grow">{t(`agent.kind.${c.kind}`)}</span>
              <span className="muted l-mono">{[c.version && `v${c.version}`, c.plan].filter(Boolean).join(' · ')}</span>
              <Chip {...(tone(c.state) ? { tone: tone(c.state) } : {})}>{t(`agent.state.${c.state}`)}</Chip>
            </li>
          ))}
          {s.accounts.map((a) => (
            <li key={`${a.kind}-${a.name}`}>
              <span className="grow">
                {t(`agent.kind.${a.kind}`)} · {a.name}
              </span>
              <span className="muted l-mono">{a.plan ?? ''}</span>
              <Chip {...(tone(a.state) ? { tone: tone(a.state) } : {})}>{t(`agent.state.${a.state}`)}</Chip>
            </li>
          ))}
        </ul>
      )}
      {s.quotas.map((q) => (
        <div key={`${q.kind}-${q.account ?? ''}`} className="quota">
          <b>
            {t('quota.title', {
              cli: q.account ? `${t(`agent.kind.${q.kind}`)} · ${q.account}` : t(`agent.kind.${q.kind}`),
            })}
          </b>
          {Object.entries(q.quota.windows)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, w]) => (
              <div key={name} className="quota__row">
                <span className="quota__name">{t(`quota.window.${name}`, name)}</span>
                <Track value={w.used} />
                <span className="quota__pct l-mono">%{Math.round(w.used * 100)}</span>
              </div>
            ))}
        </div>
      ))}
    </motion.section>
  );
}

export function StatusDialog() {
  const { t } = useTranslation();
  const statuses = useApp((s) => s.statuses);
  const team = useApp((s) => s.workspace?.kind === 'team');
  const close = useCallback(() => useApp.setState({ statusOpen: false }), []);
  useEffect(() => {
    void useApp.getState().loadStatus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return (
    <motion.div
      className="l-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <motion.div
        className="l-dialog status"
        role="dialog"
        aria-modal="true"
        aria-label={t('status.title')}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 460, damping: 34 } }}
        exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
      >
        <header className="agentform__head">
          <h2>{t('status.title')}</h2>
          <IconButton icon="close" label={t('common.close')} onClick={close} />
        </header>
        <div className="status__body">
          {statuses.map((s) => (
            <Device key={s.device} s={s} />
          ))}
          {team && <p className="muted status__hint">{t('status.teamHint')}</p>}
        </div>
      </motion.div>
    </motion.div>
  );
}
