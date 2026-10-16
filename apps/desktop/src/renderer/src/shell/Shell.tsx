import { Avatar, Button, Chip, Icon, IconButton, type IconName, Kbd, Mark, popIn, stagger } from '@lonca/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../store';

type View = 'channel' | 'tasks' | 'goals' | 'ideas' | 'references' | 'commands' | 'memory';

const NAV: { group: 'channels' | 'board' | 'records'; items: { view: View; icon: IconName }[] }[] = [
  { group: 'channels', items: [{ view: 'channel', icon: 'hash' }] },
  {
    group: 'board',
    items: [
      { view: 'tasks', icon: 'tasks' },
      { view: 'goals', icon: 'target' },
    ],
  },
  {
    group: 'records',
    items: [
      { view: 'ideas', icon: 'idea' },
      { view: 'references', icon: 'image' },
      { view: 'commands', icon: 'bookmark' },
      { view: 'memory', icon: 'layers' },
    ],
  },
];

const ICON_OF: Record<View, IconName> = {
  channel: 'hash',
  tasks: 'tasks',
  goals: 'target',
  ideas: 'idea',
  references: 'image',
  commands: 'bookmark',
  memory: 'layers',
};

function Rail({ onSettings }: { onSettings: () => void }) {
  const { t } = useTranslation();
  return (
    <nav className="rail" aria-label={t('shell.workspaces')}>
      <div className="rail__mark">
        <Mark size={32} />
      </div>
      <button type="button" className="ws is-on" aria-label={t('shell.workspace')} title={t('shell.workspace')}>
        {t('shell.workspace').slice(0, 2)}
      </button>
      <button
        type="button"
        className="ws ws--add"
        aria-label={t('shell.newWorkspace')}
        title={t('common.notYet')}
        disabled
      >
        <Icon name="plus" size={14} />
      </button>
      <span className="grow" />
      <IconButton icon="settings" label={t('shell.settings')} onClick={onSettings} />
    </nav>
  );
}

function Sidebar({ view, setView, onSettings }: { view: View; setView: (v: View) => void; onSettings: () => void }) {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const tailscale = useApp((s) => s.tailscale);
  return (
    <aside className="side" aria-label={t('shell.channels')}>
      <div className="side__ws">
        <h1>{t('shell.workspace')}</h1>
        <Icon name="chevronDown" size={14} />
      </div>
      <div className="side__store">
        <span className="dot dot--ok" />
        {t('shell.storage')}
        {tailscale?.state === 'running' && <span className="side__ts">· Tailscale</span>}
      </div>
      <button type="button" className="side__find" disabled title={t('common.notYet')}>
        <Icon name="search" size={14} />
        <span className="grow">{t('shell.search')}</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      {NAV.map((g) => (
        <div key={g.group} className="grp">
          <h2>{t(`shell.${g.group}`)}</h2>
          {g.items.map((item) => (
            <button
              key={item.view}
              type="button"
              className={`nav ${view === item.view ? 'is-on' : ''}`}
              aria-current={view === item.view ? 'page' : undefined}
              onClick={() => setView(item.view)}
            >
              {view === item.view && (
                <motion.span
                  layoutId="nav-on"
                  className="nav__on"
                  transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                />
              )}
              <Icon name={item.icon} size={14} />
              <span className="grow">
                {item.view === 'channel' ? t('shell.defaultChannel') : t(`shell.${item.view}`)}
              </span>
            </button>
          ))}
        </div>
      ))}
      <span className="grow" />
      <div className="me">
        <Avatar name={settings?.profile.name ?? ''} size={28} presence="on" />
        <div className="me__who">
          <b>{settings?.profile.name}</b>
          <span>{t('shell.role.admin')}</span>
        </div>
        <IconButton icon="mic" label={t('shell.voice')} size="sm" disabled title={t('common.notYet')} />
        <IconButton icon="settings" label={t('shell.settings')} size="sm" onClick={onSettings} />
      </div>
    </aside>
  );
}

function Main({ view }: { view: View }) {
  const { t } = useTranslation();
  const channel = t('shell.defaultChannel');
  const title = view === 'channel' ? channel : t(`shell.${view}`);
  return (
    <main className="chat">
      <header className="chat__head">
        <h2>
          <Icon name={ICON_OF[view]} size={15} />
          {title}
        </h2>
        {view === 'channel' && <span className="chat__topic">{t('shell.channelTopic')}</span>}
        <span className="grow" />
        <IconButton icon="search" label={t('shell.search')} disabled />
        <IconButton icon="board" label={t('shell.board')} disabled />
      </header>
      <AnimatePresence mode="wait">
        <motion.section
          key={view}
          className="empty"
          initial={{ opacity: 0, y: 8, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 420, damping: 32 } }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
        >
          <span className="empty__icon">
            <Icon name={ICON_OF[view]} size={22} />
          </span>
          <p className="empty__title">{t(`shell.empty.${view}`)}</p>
          <p className="empty__sub">{t('common.notYet')}</p>
        </motion.section>
      </AnimatePresence>
      {view === 'channel' && (
        <div className="composer">
          <div className="composer__box">
            <IconButton icon="plus" label={t('shell.attach')} disabled />
            <label className="l-sr" htmlFor="composer">
              {t('shell.composer', { channel })}
            </label>
            <input id="composer" placeholder={t('shell.composer', { channel })} disabled />
            <Kbd>Ctrl Space</Kbd>
            <IconButton icon="mic" label={t('shell.voice')} disabled />
            <button type="button" className="composer__send" aria-label={t('shell.send')} disabled>
              <Icon name="send" size={16} />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function Crew({ onSettings }: { onSettings: () => void }) {
  const { t } = useTranslation();
  const agents = useApp((s) => s.agents);
  const settings = useApp((s) => s.settings);
  const installed = (agents ?? []).filter((a) => a.state !== 'missing');
  return (
    <aside className="crew" aria-label={t('shell.crew')}>
      <div className="crew__head">
        <h2>{t('shell.crew')}</h2>
        <Button size="sm" icon="userPlus" disabled title={t('common.notYet')}>
          {t('shell.invite')}
        </Button>
      </div>
      <h3>
        {t('shell.workers')}
        <span className="l-mono">{installed.length}</span>
      </h3>
      {installed.length === 0 ? (
        <button type="button" className="crew__empty" onClick={onSettings}>
          {t('shell.noWorkers')}
        </button>
      ) : (
        <motion.ul variants={stagger} initial="hidden" animate="shown" className="crew__list">
          {installed.map((a) => (
            <motion.li key={a.kind} variants={popIn} className={`who ${a.state === 'ready' ? '' : 'is-off'}`}>
              <Avatar name="" icon="terminal" size={28} presence={a.state === 'ready' ? 'on' : 'off'} />
              <div className="who__text">
                <b>
                  {t(`agent.kind.${a.kind}`)} · {settings?.profile.name}
                </b>
                <span>{t(`agent.state.${a.state}`)}</span>
              </div>
              {a.version && <Chip mono>{a.version}</Chip>}
            </motion.li>
          ))}
        </motion.ul>
      )}
      <h3>{t('shell.advisors')}</h3>
      <p className="crew__none">{t('shell.noAdvisors')}</p>
      <h3>
        {t('shell.members')}
        <span className="l-mono">1</span>
      </h3>
      <div className="who">
        <Avatar name={settings?.profile.name ?? ''} size={28} presence="on" />
        <div className="who__text">
          <b>{settings?.profile.name}</b>
          <span>{t('shell.role.admin')}</span>
        </div>
      </div>
    </aside>
  );
}

export function Shell({ onSettings }: { onSettings: () => void }) {
  const [view, setView] = useState<View>('channel');
  return (
    <motion.div
      className="shell"
      initial={{ opacity: 0, scale: 1.01 }}
      animate={{ opacity: 1, scale: 1, transition: { duration: 0.3 } }}
    >
      <Rail onSettings={onSettings} />
      <Sidebar view={view} setView={setView} onSettings={onSettings} />
      <Main view={view} />
      <Crew onSettings={onSettings} />
    </motion.div>
  );
}
