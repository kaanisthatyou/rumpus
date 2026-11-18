// The efficiency meter (PLAN.md 5.21): like a battery's health, a dial of segments that light up to the share of the
// last seven days' jobs that were completed, out of those that ended (done, failed or stopped). The number is exact
// to two decimals, never rounded to a whole one, and its state is said in words beside the color.
import type { Overview } from '@lonca/protocol';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';

const SEGMENTS = 32;
/** The dial's sweep, in degrees, open at the bottom. */
const SWEEP = 240;

/** The share of ended jobs that were done (0 to 1), or undefined while none ended. */
export function efficiency(week: Overview['week'] | undefined): number | undefined {
  if (!week) return undefined;
  const ended = week.done + week.failed + week.stopped;
  return ended > 0 ? week.done / ended : undefined;
}

/** The ratio as an exact percent: `%87,50` in Turkish, `87.50%` in English. */
export function percent(ratio: number, lang: string): string {
  return new Intl.NumberFormat(lang, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    ratio,
  );
}

export function zoneOf(ratio: number | undefined): 'none' | 'good' | 'fair' | 'poor' {
  if (ratio === undefined) return 'none';
  return ratio >= 0.85 ? 'good' : ratio >= 0.6 ? 'fair' : 'poor';
}

export function EfficiencyMeter({ week, size = 168 }: { week: Overview['week'] | undefined; size?: number }) {
  const { t, i18n } = useTranslation();
  const ratio = efficiency(week);
  const zone = zoneOf(ratio);
  const lit = ratio === undefined ? 0 : Math.round(ratio * SEGMENTS);
  const ended = week ? week.done + week.failed + week.stopped : 0;
  const c = 50;
  const outer = 46;
  const inner = 37;
  const start = -90 - SWEEP / 2;
  const step = SWEEP / SEGMENTS;
  const at = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    return [c + r * Math.cos(a), c + r * Math.sin(a)] as const;
  };
  return (
    <div className={`meter meter--${zone}`} style={{ width: size }}>
      <svg viewBox="0 0 100 86" width={size} height={(size * 86) / 100} aria-hidden="true">
        {Array.from({ length: SEGMENTS }, (_, i) => {
          // Each segment is a short radial bar with a gap on both sides.
          const mid = start + step * (i + 0.5);
          const [x1, y1] = at(mid, inner);
          const [x2, y2] = at(mid, outer);
          const on = i < lit;
          return (
            <motion.line
              // biome-ignore lint/suspicious/noArrayIndexKey: the segments are fixed positions on the dial
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className={on ? 'meter__seg is-on' : 'meter__seg'}
              initial={on ? { opacity: 0.15 } : false}
              animate={{ opacity: 1 }}
              transition={{ delay: on ? i * 0.018 : 0, duration: 0.2 }}
            />
          );
        })}
      </svg>
      <div className="meter__read">
        <span className="meter__label">{t('overview.efficiency.title')}</span>
        <b className="meter__value l-mono">{ratio === undefined ? '—' : percent(ratio, i18n.language)}</b>
        <span className="meter__zone">{t(`overview.efficiency.${zone}`)}</span>
      </div>
      <span className="meter__sub">
        {ratio === undefined
          ? t('overview.efficiency.empty')
          : t('overview.efficiency.done', { done: week?.done ?? 0, ended })}
      </span>
    </div>
  );
}
