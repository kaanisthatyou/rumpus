// Small formatting helpers shared by the channel views.

export function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function elapsed(from: number, to: number): string {
  const s = Math.max(0, Math.floor((to - from) / 1000));
  const m = Math.floor(s / 60);
  return m >= 60
    ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    : `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function tokens(n: number, lang: string): string {
  if (n < 1000) return String(n);
  const v = n >= 100_000 ? Math.round(n / 1000) : Math.round(n / 100) / 10;
  return `${v.toLocaleString(lang, { maximumFractionDigits: 1 })}k`;
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(ms: number, lang: string, today: string, yesterday: string): string {
  const now = new Date();
  const d = new Date(ms);
  if (dayKey(ms) === dayKey(now.getTime())) return today;
  if (dayKey(ms) === dayKey(now.getTime() - 86_400_000)) return yesterday;
  return d.toLocaleDateString(lang, {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}
