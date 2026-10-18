import type { CliKind, Quota } from '@lonca/protocol';
import { Avatar, Button, Icon, IconButton, type IconName, Kbd, Mark, popIn, stagger, Track } from '@lonca/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RUNNABLE } from '../agents/AgentDialog';
import { Board } from '../board/Board';
import { ChannelView } from '../channel/ChannelView';
import { LiveView } from '../channel/LiveView';
import { GoalsView } from '../goals/GoalsView';
import { RecordsView } from '../records/RecordsView';
import { useApp, type View } from '../store';

const BOARD: { view: View; icon: IconName }[] = [
  { view: 'tasks', icon: 'tasks' },
  { view: 'goals', icon: 'target' },
];
const RECORDS: { view: View; icon: IconName }[] = [
  { view: 'ideas', icon: 'idea' },
  { view: 'references', icon: 'image' },
  { view: 'commands', icon: 'bookmark' },
  { view: 'memory', icon: 'layers' },
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

function NavButton({
  on,
  icon,
  label,
  onClick,
  badge,
}: {
  on: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
  badge?: boolean;
}) {
  return (
    <button
      type="button"
      className={`nav ${on ? 'is-on' : ''}`}
      aria-current={on ? 'page' : undefined}
      onClick={onClick}
    >
      {on && (
        <motion.span
          layoutId="nav-on"
          className="nav__on"
          transition={{ type: 'spring', stiffness: 520, damping: 38 }}
        />
      )}
      <Icon name={icon} size={14} />
      <span className="grow">{label}</span>
      {badge && <span className="nav__live" aria-hidden="true" />}
    </button>
  );
}

function Rail({ onSettings }: { onSettings: () => void }) {
  const { t } = useTranslation();
  const workspaces = useApp((s) => s.workspaces);
  const current = useApp((s) => s.workspace?.id);
  const openWorkspace = useApp((s) => s.openWorkspace);
  return (
    <nav className="rail" aria-label={t('shell.workspaces')}>
      <div className="rail__mark">
        <Mark size={32} />
      </div>
      {workspaces.map((w) => {
        const name = w.kind === 'personal' ? t('shell.workspace') : w.name;
        return (
          <button
            key={w.id}
            type="button"
            className={`ws ${w.id === current ? 'is-on' : ''}`}
            aria-label={name}
            aria-current={w.id === current ? 'page' : undefined}
            title={name}
            onClick={() => void openWorkspace(w.id)}
          >
            {name.slice(0, 2)}
          </button>
        );
      })}
      <button
        type="button"
        className="ws ws--add"
        aria-label={t('shell.newWorkspace')}
        title={t('shell.newWorkspace')}
        onClick={() => useApp.setState({ newWorkspaceOpen: true })}
      >
        <Icon name="plus" size={14} />
      </button>
      <span className="grow" />
      <IconButton icon="settings" label={t('shell.settings')} onClick={onSettings} />
    </nav>
  );
}

function Sidebar({ onSettings }: { onSettings: () => void }) {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const tailscale = useApp((s) => s.tailscale);
  const workspace = useApp((s) => s.workspace);
  const view = useApp((s) => s.view);
  const channelId = useApp((s) => s.channelId);
  const jobs = useApp((s) => s.jobs);
  const openChannel = useApp((s) => s.openChannel);
  const setView = useApp((s) => s.setView);
  const createChannel = useApp((s) => s.createChannel);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const channels = workspace?.channels.filter((c) => c.kind === 'channel') ?? [];
  const agentChannels = workspace?.channels.filter((c) => c.kind === 'agent') ?? [];
  const waiting = Object.values(jobs)
    .filter((j) => j.state === 'attention')
    .sort((a, b) => a.started - b.started);
  const running = new Set(
    Object.values(jobs)
      .filter((j) => j.state === 'running')
      .map((j) => j.channelId),
  );

  return (
    <aside className="side" aria-label={t('shell.channels')}>
      <div className="side__ws">
        <h1>{workspace?.kind === 'team' ? workspace.name : t('shell.workspace')}</h1>
        <Icon name="chevronDown" size={14} />
      </div>
      <div className="side__store">
        <span className="dot dot--ok" />
        {workspace?.kind === 'team' ? t('shell.teamStorage') : t('shell.storage')}
        {tailscale?.state === 'running' && <span className="side__ts">· Tailscale</span>}
      </div>
      <button type="button" className="side__find" onClick={() => useApp.getState().setPalette(true)}>
        <Icon name="search" size={14} />
        <span className="grow">{t('shell.search')}</span>
        <Kbd>Ctrl K</Kbd>
      </button>

      <div className="grp">
        <h2>
          <span className="grow">{t('shell.channels')}</span>
          <IconButton size="sm" icon="plus" label={t('channel.create')} onClick={() => setCreating((v) => !v)} />
        </h2>
        {creating && (
          <form
            className="side__new"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await createChannel(name)) {
                setName('');
                setCreating(false);
              }
            }}
          >
            <input
              className="l-input"
              // biome-ignore lint/a11y/noAutofocus: the field opens on request, typing is the next step
              autoFocus
              value={name}
              aria-label={t('channel.create')}
              placeholder={t('channel.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
            />
          </form>
        )}
        {channels.map((c) => (
          <NavButton
            key={c.id}
            on={view === 'channel' && channelId === c.id}
            icon="hash"
            label={c.name}
            badge={running.has(c.id)}
            onClick={() => void openChannel(c.id)}
          />
        ))}
      </div>
      {agentChannels.length > 0 && (
        <div className="grp">
          <h2>{t('channel.agents')}</h2>
          {agentChannels.map((c) => (
            <NavButton
              key={c.id}
              on={view === 'channel' && channelId === c.id}
              icon="terminal"
              label={`@${c.name}`}
              badge={running.has(c.id)}
              onClick={() => void openChannel(c.id)}
            />
          ))}
        </div>
      )}
      {waiting.length > 0 && (
        <div className="grp">
          <button
            type="button"
            className="nav nav--waiting"
            onClick={() => waiting[0] && void useApp.getState().openJob(waiting[0].id)}
          >
            <Icon name="alert" size={14} />
            <span className="grow">{t('shell.waiting')}</span>
            <span className="badge-count">{waiting.length}</span>
          </button>
        </div>
      )}
      <div className="grp">
        <h2>{t('shell.board')}</h2>
        {BOARD.map((item) => (
          <NavButton
            key={item.view}
            on={view === item.view}
            icon={item.icon}
            label={t(`shell.${item.view}`)}
            onClick={() => setView(item.view)}
          />
        ))}
      </div>
      <div className="grp">
        <h2>{t('shell.records')}</h2>
        {RECORDS.map((item) => (
          <NavButton
            key={item.view}
            on={view === item.view}
            icon={item.icon}
            label={t(`shell.${item.view}`)}
            onClick={() => setView(item.view)}
          />
        ))}
      </div>
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

function Placeholder({ view }: { view: View }) {
  const { t } = useTranslation();
  return (
    <main className="chat">
      <header className="chat__head">
        <h2>
          <Icon name={ICON_OF[view]} size={15} />
          {t(`shell.${view}`)}
        </h2>
      </header>
      <motion.section
        key={view}
        className="empty"
        initial={{ opacity: 0, y: 8, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 420, damping: 32 } }}
      >
        <span className="empty__icon">
          <Icon name={ICON_OF[view]} size={22} />
        </span>
        <p className="empty__title">{t(`shell.empty.${view}`)}</p>
        <p className="empty__sub">{t('common.notYet')}</p>
      </motion.section>
    </main>
  );
}

function QuotaBlock({ kind, quota }: { kind: CliKind; quota: Quota }) {
  const { t } = useTranslation();
  const windows = Object.entries(quota.windows).sort(([a], [b]) => a.localeCompare(b));
  if (windows.length === 0) return null;
  return (
    <div className="quota">
      <b>{t('quota.title', { cli: t(`agent.kind.${kind}`) })}</b>
      {windows.map(([name, w]) => (
        <div key={name} className="quota__row">
          <span className="quota__name">{t(`quota.window.${name}`, name)}</span>
          <Track value={w.used} />
          <span className="quota__pct l-mono">%{Math.round(w.used * 100)}</span>
        </div>
      ))}
    </div>
  );
}

function Crew() {
  const { t } = useTranslation();
  const workspace = useApp((s) => s.workspace);
  const clis = useApp((s) => s.clis);
  const jobs = useApp((s) => s.jobs);
  const quota = useApp((s) => s.quota);
  const openChannel = useApp((s) => s.openChannel);
  const openAgentDialog = useApp((s) => s.openAgentDialog);
  const openAdvisorDialog = useApp((s) => s.openAdvisorDialog);
  const typing = useApp((s) => s.typing);
  const agents = workspace?.agents ?? [];
  const advisors = workspace?.advisors ?? [];
  const busy = new Set(
    Object.values(jobs)
      .filter((j) => j.state === 'running' || j.state === 'attention')
      .map((j) => j.agentId),
  );
  const asking = new Set(
    Object.values(jobs)
      .filter((j) => j.state === 'attention')
      .map((j) => j.agentId),
  );
  const used = new Set(agents.map((a) => a.kind));
  const suggestions = (clis ?? []).filter(
    (c) => RUNNABLE.includes(c.kind) && c.state !== 'missing' && !used.has(c.kind),
  );
  const me = workspace?.me;

  return (
    <motion.aside
      className="crew"
      aria-label={t('shell.crew')}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
    >
      <div className="crew__head">
        <h2>{t('shell.crew')}</h2>
        <Button size="sm" icon="userPlus" disabled title={t('common.notYet')}>
          {t('shell.invite')}
        </Button>
      </div>
      <h3>
        <span className="grow">{t('shell.workers')}</span>
        <IconButton size="sm" icon="plus" label={t('crew.addAgent')} onClick={() => openAgentDialog('new')} />
      </h3>
      <motion.ul variants={stagger} initial="hidden" animate="shown" className="crew__list">
        {agents.map((a) => {
          const cli = clis?.find((c) => c.kind === a.kind);
          const missing = !cli || cli.state === 'missing';
          const channel = workspace?.channels.find((c) => c.kind === 'agent' && c.agentId === a.id);
          const state = missing
            ? t('crew.cliMissing')
            : asking.has(a.id)
              ? t('job.approval.title')
              : busy.has(a.id)
                ? t('crew.running')
                : t('crew.idle');
          return (
            <motion.li key={a.id} variants={popIn} className={`who ${missing ? 'is-off' : ''}`}>
              <button type="button" className="who__open" onClick={() => channel && void openChannel(channel.id)}>
                <Avatar name="" icon="terminal" size={28} presence={missing ? 'off' : busy.has(a.id) ? 'busy' : 'on'} />
                <div className="who__text">
                  <b>
                    {a.name} <span className="l-mono">@{a.handle}</span>
                  </b>
                  <span>
                    {t(`agent.kind.${a.kind}`)} · {state}
                  </span>
                </div>
              </button>
              <IconButton size="sm" icon="settings" label={t('agentForm.edit')} onClick={() => openAgentDialog(a)} />
            </motion.li>
          );
        })}
      </motion.ul>
      {agents.length === 0 && suggestions.length === 0 && <p className="crew__none">{t('shell.noWorkers')}</p>}
      {suggestions.length > 0 && (
        <div className="crew__suggest">
          <span>{t('crew.suggest')}</span>
          {suggestions.map((c) => (
            <div key={c.kind} className="who is-suggest">
              <Avatar name="" icon="terminal" size={28} />
              <div className="who__text">
                <b>{t(`agent.kind.${c.kind}`)}</b>
                <span className="l-mono">{c.version ? `v${c.version}` : ''}</span>
              </div>
              <Button size="sm" icon="plus" onClick={() => openAgentDialog({ kind: c.kind })}>
                {t('crew.add')}
              </Button>
            </div>
          ))}
        </div>
      )}
      <h3>
        <span className="grow">{t('shell.advisors')}</span>
        <IconButton size="sm" icon="plus" label={t('advisorForm.new')} onClick={() => openAdvisorDialog('new')} />
      </h3>
      {advisors.length === 0 ? (
        <p className="crew__none">{t('shell.noAdvisors')}</p>
      ) : (
        <motion.ul variants={stagger} initial="hidden" animate="shown" className="crew__list">
          {advisors.map((a) => {
            const used = Math.min(1, (workspace?.spend[a.id] ?? 0) / a.dailyTokens);
            const writing = Object.values(typing).some((ids) => ids.includes(a.id));
            return (
              <motion.li key={a.id} variants={popIn} className="who who--advisor">
                <div className="who__open">
                  <Avatar name={a.name} size={28} presence={writing ? 'busy' : a.chatter === 'off' ? 'off' : 'on'} />
                  <div className="who__text">
                    <b>
                      {a.name} <span className="l-mono">@{a.handle}</span>
                    </b>
                    <span>
                      {writing ? t('advisor.writing') : t(`advisorForm.personalities.${a.personality}`)} ·{' '}
                      <span className={used >= 1 ? 'is-warn' : ''}>
                        {t('advisor.spent', { percent: Math.round(used * 100) })}
                      </span>
                    </span>
                  </div>
                </div>
                <IconButton
                  size="sm"
                  icon="settings"
                  label={t('advisorForm.edit')}
                  onClick={() => openAdvisorDialog(a)}
                />
              </motion.li>
            );
          })}
        </motion.ul>
      )}
      <h3>
        <span className="grow">{t('shell.members')}</span>
        <span className="l-mono">1</span>
      </h3>
      <div className="who">
        <Avatar name={me?.name ?? ''} size={28} presence="on" />
        <div className="who__text">
          <b>{me?.name}</b>
          <span>{t('shell.role.admin')}</span>
        </div>
      </div>
      <span className="grow" />
      {Object.entries(quota).map(([kind, q]) => q && <QuotaBlock key={kind} kind={kind as CliKind} quota={q} />)}
    </motion.aside>
  );
}

export function Shell({ onSettings }: { onSettings: () => void }) {
  const view = useApp((s) => s.view);
  const channel = useApp((s) => s.workspace?.channels.find((c) => c.id === s.channelId));
  const watching = useApp((s) => s.watching);
  return (
    <motion.div
      className="shell"
      initial={{ opacity: 0, scale: 1.01 }}
      animate={{ opacity: 1, scale: 1, transition: { duration: 0.3 } }}
    >
      <Rail onSettings={onSettings} />
      <Sidebar onSettings={onSettings} />
      {view === 'channel' && channel ? (
        <ChannelView key={channel.id} channel={channel} />
      ) : view === 'tasks' ? (
        <Board />
      ) : view === 'goals' ? (
        <GoalsView />
      ) : view === 'ideas' || view === 'references' || view === 'commands' ? (
        <RecordsView key={view} kind={view === 'ideas' ? 'idea' : view === 'references' ? 'reference' : 'command'} />
      ) : (
        <Placeholder view={view} />
      )}
      <AnimatePresence mode="wait">
        {watching ? <LiveView key={watching} jobId={watching} /> : <Crew key="crew" />}
      </AnimatePresence>
    </motion.div>
  );
}
