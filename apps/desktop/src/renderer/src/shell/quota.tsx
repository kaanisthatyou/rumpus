// A login's quota as bars: the shell's corner, `/durum` and the profile cards all show it the same way.
import type { CliKind, Quota } from '@lonca/protocol';
import { Track } from '@lonca/ui';
import { useTranslation } from 'react-i18next';
import { useApp } from '../store';

/**
 * The windows worth a bar, in this order. Claude Code also reports bookkeeping windows (for example
 * `seven_day_overage_included`) that say nothing about how much is left; those are not shown.
 */
const SHOWN = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'];

export function quotaWindows(quota: Quota | undefined): [string, { used: number; resets?: number }][] {
  const windows = quota?.windows ?? {};
  return SHOWN.flatMap((name) => {
    const w = windows[name];
    return w ? [[name, w] as [string, { used: number; resets?: number }]] : [];
  });
}

export function QuotaBars({ title, quota }: { title: string; quota: Quota | undefined }) {
  const { t } = useTranslation();
  const windows = quotaWindows(quota);
  if (windows.length === 0) return null;
  return (
    <div className="quota">
      <b>{title}</b>
      {windows.map(([name, w]) => (
        <div key={name} className="quota__row">
          <span className="quota__name" title={t(`quota.window.${name}`, name)}>
            {t(`quota.window.${name}`, name)}
          </span>
          <Track value={Math.min(1, w.used)} />
          <span className="quota__pct l-mono">%{Math.round(w.used * 100)}</span>
        </div>
      ))}
    </div>
  );
}

/** One of this computer's logins by its quota key: `claude-code`, or `claude-code:<account>` for an extra login. */
export function QuotaBlock({ id, quota }: { id: string; quota: Quota | undefined }) {
  const { t } = useTranslation();
  const [kind, accountId] = id.split(':') as [CliKind, string | undefined];
  const account = useApp((s) => (accountId ? s.accounts.find((a) => a.id === accountId) : undefined));
  const cli = t(`agent.kind.${kind}`);
  return <QuotaBars title={t('quota.title', { cli: account ? `${cli} · ${account.name}` : cli })} quota={quota} />;
}
