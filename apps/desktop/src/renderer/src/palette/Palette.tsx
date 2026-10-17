// Ctrl K: one box to reach channels, agents, views, actions and messages.
import type { Message } from '@lonca/protocol';
import { Icon, IconButton, type IconName, Kbd } from '@lonca/ui';
import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { core } from '../rpc';
import { useApp, type View } from '../store';

interface Item {
  id: string;
  group: 'channels' | 'agents' | 'views' | 'actions' | 'messages';
  icon: IconName;
  label: string;
  detail?: string;
  run: () => void;
}

const VIEWS: { view: View; icon: IconName }[] = [
  { view: 'tasks', icon: 'tasks' },
  { view: 'goals', icon: 'target' },
  { view: 'ideas', icon: 'idea' },
  { view: 'references', icon: 'image' },
  { view: 'commands', icon: 'bookmark' },
  { view: 'memory', icon: 'layers' },
];

const fold = (s: string) => s.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');

export function Palette({ onSettings }: { onSettings: () => void }) {
  const { t } = useTranslation();
  const workspace = useApp((s) => s.workspace);
  const setPalette = useApp((s) => s.setPalette);
  const [query, setQuery] = useState('');
  const [pick, setPick] = useState(0);
  const [found, setFound] = useState<Message[]>([]);
  const close = () => setPalette(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setFound([]);
      return;
    }
    const timer = setTimeout(() => {
      void core
        .call('messages.search', { query: q, limit: 8 })
        .then(setFound)
        .catch(() => setFound([]));
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  const items = useMemo<Item[]>(() => {
    const s = useApp.getState();
    const all: Item[] = [];
    for (const c of workspace?.channels ?? []) {
      const agent = c.kind === 'agent' ? workspace?.agents.find((a) => a.id === c.agentId) : undefined;
      all.push({
        id: `c-${c.id}`,
        group: agent ? 'agents' : 'channels',
        icon: agent ? 'terminal' : 'hash',
        label: agent ? `@${agent.handle}` : c.name,
        ...(agent ? { detail: agent.name } : {}),
        run: () => void s.openChannel(c.id),
      });
    }
    for (const v of VIEWS)
      all.push({
        id: `v-${v.view}`,
        group: 'views',
        icon: v.icon,
        label: t(`shell.${v.view}`),
        run: () => s.setView(v.view),
      });
    all.push(
      {
        id: 'a-agent',
        group: 'actions',
        icon: 'plus',
        label: t('palette.addAgent'),
        run: () => s.openAgentDialog('new'),
      },
      { id: 'a-settings', group: 'actions', icon: 'settings', label: t('palette.settings'), run: onSettings },
      {
        id: 'a-shortcuts',
        group: 'actions',
        icon: 'keyboard',
        label: t('palette.shortcuts'),
        run: () => s.setShortcuts(true),
      },
    );
    const q = fold(query.trim());
    const matched = q ? all.filter((i) => fold(`${i.label} ${i.detail ?? ''}`).includes(q)) : all;
    for (const m of found) {
      const channel = workspace?.channels.find((c) => c.id === m.channelId);
      matched.push({
        id: `m-${m.id}`,
        group: 'messages',
        icon: 'search',
        label: m.text.length > 90 ? `${m.text.slice(0, 90)}…` : m.text,
        detail: `${m.author.kind === 'system' ? 'Lonca' : m.author.name} · #${channel?.name ?? ''}`,
        run: () => void s.openChannel(m.channelId),
      });
    }
    return matched;
  }, [workspace, query, found, t, onSettings]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    close();
    item.run();
  };
  const groups = ['channels', 'agents', 'views', 'actions', 'messages'] as const;
  const index = items.length ? pick % items.length : 0;

  return (
    <motion.div
      className="l-overlay palette-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <motion.div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={t('shell.search')}
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 520, damping: 36 } }}
        exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
      >
        <div className="palette__input">
          <Icon name="search" size={16} />
          <input
            // biome-ignore lint/a11y/noAutofocus: the palette exists to be typed into
            autoFocus
            value={query}
            placeholder={t('palette.placeholder')}
            aria-label={t('palette.placeholder')}
            onChange={(e) => {
              setQuery(e.target.value);
              setPick(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setPick((p) =>
                  items.length ? (p + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length : 0,
                );
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(items[index]);
              }
            }}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="palette__list">
          {items.length === 0 && <p className="muted palette__none">{t('palette.none')}</p>}
          {groups.map((g) => {
            const inGroup = items.filter((i) => i.group === g);
            if (inGroup.length === 0) return null;
            return (
              <div key={g} className="palette__group">
                <h4>{t(`palette.${g}`)}</h4>
                {inGroup.map((item) => {
                  const i = items.indexOf(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`palette__item ${i === index ? 'is-on' : ''}`}
                      onMouseEnter={() => setPick(i)}
                      onClick={() => choose(item)}
                    >
                      <Icon name={item.icon} size={14} />
                      <span className="palette__label">{item.label}</span>
                      {item.detail && <span className="palette__detail">{item.detail}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}

export function ShortcutsDialog() {
  const { t } = useTranslation();
  const setShortcuts = useApp((s) => s.setShortcuts);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setShortcuts(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setShortcuts]);
  const rows: [string, string][] = [
    ['Ctrl K', t('shortcuts.palette')],
    ['Ctrl ,', t('shortcuts.settings')],
    ['Alt ↑', t('shortcuts.prevChannel')],
    ['Alt ↓', t('shortcuts.nextChannel')],
    ['Ctrl .', t('shortcuts.stop')],
    ['Ctrl Shift ↓', t('shortcuts.nextWaiting')],
    ['Ctrl /', t('shortcuts.list')],
    ['Enter', t('shortcuts.send')],
    ['Shift Enter', t('shortcuts.newline')],
    ['@', t('shortcuts.mention')],
    ['/', t('shortcuts.command')],
  ];
  return (
    <motion.div
      className="l-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && setShortcuts(false)}
    >
      <motion.div
        className="l-dialog shortcuts"
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcuts.title')}
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6 }}
      >
        <header className="agentform__head">
          <h2>{t('shortcuts.title')}</h2>
          <IconButton icon="close" label={t('common.close')} onClick={() => setShortcuts(false)} />
        </header>
        <dl className="shortcuts__list">
          {rows.map(([keys, label]) => (
            <div key={keys} className="shortcuts__row">
              <dt>
                <Kbd>{keys}</Kbd>
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </motion.div>
    </motion.div>
  );
}
