import { type CliKind, type Job, MEMBER_ROLES, type MemberRole, type Quota } from '@lonca/protocol';
import { Avatar, Button, Icon, IconButton, type IconName, Kbd, Mark, popIn, stagger, Track } from '@lonca/ui';
import type { TFunction } from 'i18next';
import { AnimatePresence, motion } from 'motion/react';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RUNNABLE } from '../agents/AgentDialog';
import { remoteOwner, runsHere } from '../agents/owner';
import { specialistIcon } from '../agents/SpecialistDialog';
import { Board } from '../board/Board';
import { ChannelView } from '../channel/ChannelView';
import { LiveView } from '../channel/LiveView';
import { GoalsView } from '../goals/GoalsView';
import { useMedia } from '../media';
import { MemoryView } from '../memory/MemoryView';
import { OverviewView } from '../overview/OverviewView';
import { nameStyle, PersonAvatar, PersonButton, personOf, useFace, WorkspaceIcon } from '../people/people';
import { ProjectPage } from '../projects/ProjectView';
import { RecordsView } from '../records/RecordsView';
import { RoutinesView } from '../routines/RoutinesView';
import { PHONE, useApp, type View, WIDE } from '../store';
import { enablePush, pushState } from '../web';
import { FriendAvatar } from './FriendsDialog';
import { useTaskbar } from './taskbar';

const BOARD: { view: View; icon: IconName }[] = [
  { view: 'tasks', icon: 'tasks' },
  { view: 'goals', icon: 'target' },
  { view: 'routines', icon: 'clock' },
];
const RECORDS: { view: View; icon: IconName }[] = [
  { view: 'ideas', icon: 'idea' },
  { view: 'references', icon: 'image' },
  { view: 'commands', icon: 'bookmark' },
  { view: 'memory', icon: 'layers' },
];
const ICON_OF: Record<View, IconName> = {
  home: 'home',
  channel: 'hash',
  tasks: 'tasks',
  goals: 'target',
  routines: 'clock',
  ideas: 'idea',
  references: 'image',
  commands: 'bookmark',
  memory: 'layers',
  project: 'folder',
};

function NavButton({
  on,
  icon,
  label,
  onClick,
  badge,
  unread,
}: {
  on: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
  badge?: boolean;
  /** Messages that arrived since the channel was last open; `mention` when one of them names this person. */
  unread?: { count: number; mention?: boolean };
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={`nav ${on ? 'is-on' : ''} ${unread ? 'is-unread' : ''}`}
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
      {unread && (
        <span
          className={`nav__unread ${unread.mention ? 'is-mention' : ''}`}
          title={t(unread.mention ? 'channel.unreadMention' : 'channel.unread', { count: unread.count })}
        >
          {unread.mention ? '@' : ''}
          {unread.count > 99 ? '99+' : unread.count}
        </span>
      )}
    </button>
  );
}

function Rail({ onSettings }: { onSettings: () => void }) {
  const { t } = useTranslation();
  const workspaces = useApp((s) => s.workspaces);
  const current = useApp((s) => s.workspace?.id);
  const openWorkspace = useApp((s) => s.openWorkspace);
  const activity = useApp((s) => s.activity);
  const sidebar = useApp((s) => s.settings?.sidebar !== false);
  const toggleSidebar = useApp((s) => s.toggleSidebar);
  const asking = useApp((s) => s.friends?.requests.length ?? 0);
  const reach = useApp((s) => s.friends?.friends);
  // Workspaces first; conversations with friends stand apart, under the friends button.
  const spaces = useMemo(() => workspaces.filter((w) => !w.friend), [workspaces]);
  const direct = useMemo(() => workspaces.filter((w) => w.friend), [workspaces]);
  return (
    <nav className="rail" aria-label={t('shell.workspaces')}>
      <div className="rail__mark">
        <Mark size={32} />
      </div>
      {spaces.map((w) => {
        const name = w.kind === 'personal' ? t('shell.workspace') : w.name;
        const fresh = activity[w.id] === true && w.id !== current;
        const note = w.state
          ? `${name} · ${t(`workspaces.state.${w.state}`)}`
          : fresh
            ? `${name} · ${t('workspaces.news')}`
            : name;
        return (
          <button
            key={w.id}
            type="button"
            className={`ws ${w.id === current ? 'is-on' : ''} ${w.state ? `is-${w.state}` : ''}`}
            aria-label={note}
            aria-current={w.id === current ? 'page' : undefined}
            title={note}
            disabled={Boolean(w.state)}
            onClick={() => void openWorkspace(w.id)}
          >
            <WorkspaceIcon name={name} icon={w.icon} />
            {fresh && <span className="ws__dot" aria-hidden="true" />}
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
      <span className="rail__rule" aria-hidden="true" />
      <button
        type="button"
        className="ws ws--friends"
        aria-label={
          asking > 0 ? `${t('friends.title')} · ${t('friends.requestCount', { count: asking })}` : t('friends.title')
        }
        title={t('friends.title')}
        onClick={() => useApp.setState({ friendsOpen: true })}
      >
        <Icon name="users" size={16} />
        {asking > 0 && <span className="ws__dot" aria-hidden="true" />}
      </button>
      {direct.map((w) => {
        const fresh = activity[w.id] === true && w.id !== current;
        const name = w.friend?.name ?? w.name;
        const note = fresh ? `${name} · ${t('workspaces.news')}` : name;
        return (
          <button
            key={w.id}
            type="button"
            className={`ws ws--dm ${w.id === current ? 'is-on' : ''}`}
            aria-label={note}
            aria-current={w.id === current ? 'page' : undefined}
            title={note}
            onClick={() => void openWorkspace(w.id)}
          >
            <FriendAvatar
              name={name}
              avatar={w.friend?.avatar}
              size={36}
              online={reach?.find((f) => f.workspace === w.id)?.online}
            />
            {fresh && <span className="ws__dot" aria-hidden="true" />}
          </button>
        );
      })}
      <span className="grow" />
      <IconButton
        icon="panelLeft"
        className="rail__side"
        label={t(sidebar ? 'shell.hideSidebar' : 'shell.showSidebar')}
        aria-pressed={sidebar}
        onClick={toggleSidebar}
      />
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
  const projects = useApp((s) => s.projects);
  const projectId = useApp((s) => s.projectId);
  const openProject = useApp((s) => s.openProject);
  const openProjectDialog = useApp((s) => s.openProjectDialog);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const unread = useApp((s) => s.unread);
  const channels = workspace?.channels.filter((c) => c.kind === 'channel') ?? [];
  const agentChannels = workspace?.channels.filter((c) => c.kind === 'agent') ?? [];
  // Jobs that wait for this person: an approval is given on the computer the agent runs on.
  const waiting = Object.values(jobs)
    .filter((j) => j.state === 'attention' && runsHere(j, workspace))
    .sort((a, b) => a.started - b.started);
  const banner = useFace(workspace?.kind === 'team' ? workspace.banner : undefined, false);
  const mine = personOf(workspace, settings, workspace?.me.id ?? '');
  const running = new Set(
    Object.values(jobs)
      .filter((j) => j.state === 'running')
      .map((j) => j.channelId),
  );

  return (
    <aside className="side" aria-label={t('shell.channels')}>
      {banner && <div className="side__banner" style={{ backgroundImage: `url("${banner}")` }} aria-hidden="true" />}
      <div className="side__ws">
        <h1>{workspace?.kind === 'team' ? workspace.name : t('shell.workspace')}</h1>
        {workspace?.kind === 'team' && !workspace.friend ? (
          <IconButton
            size="sm"
            icon="chevronDown"
            label={t('wsForm.open')}
            onClick={() => useApp.setState({ workspaceDialog: true })}
          />
        ) : (
          <Icon name={workspace?.friend ? 'user' : 'chevronDown'} size={14} />
        )}
      </div>
      {workspace?.kind === 'team' && workspace.about && <p className="side__about">{workspace.about}</p>}
      <div className="side__store">
        <span className="dot dot--ok" />
        {workspace?.friend
          ? t('friends.direct')
          : workspace?.kind === 'team'
            ? t('shell.teamStorage')
            : t('shell.storage')}
        {tailscale?.state === 'running' && <span className="side__ts">· Tailscale</span>}
      </div>
      <button type="button" className="side__find" onClick={() => useApp.getState().setPalette(true)}>
        <Icon name="search" size={14} />
        <span className="grow">{t('shell.search')}</span>
        <Kbd>Ctrl K</Kbd>
      </button>

      <div className="grp">
        <NavButton on={view === 'home'} icon="home" label={t('shell.home')} onClick={() => setView('home')} />
      </div>
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
            {...(unread[c.id] ? { unread: unread[c.id] } : {})}
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
              icon={
                workspace?.agents.find((a) => a.id === c.agentId)?.specialty
                  ? specialistIcon(workspace.agents.find((a) => a.id === c.agentId))
                  : 'terminal'
              }
              label={`@${c.name}`}
              badge={running.has(c.id)}
              {...(unread[c.id] ? { unread: unread[c.id] } : {})}
              onClick={() => void openChannel(c.id)}
            />
          ))}
        </div>
      )}
      <div className="grp">
        <h2>
          <span className="grow">{t('shell.projects')}</span>
          <IconButton size="sm" icon="plus" label={t('project.new')} onClick={() => openProjectDialog('new')} />
        </h2>
        {projects.map((p) => (
          <NavButton
            key={p.id}
            on={view === 'project' && projectId === p.id}
            icon="folder"
            label={p.name}
            onClick={() => openProject(p.id)}
          />
        ))}
      </div>
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
        <PersonButton id={mine.id} name={mine.name} className="me__open">
          <PersonAvatar id={mine.id} name={mine.name} size={28} presence="on" />
          <span className="me__who">
            <b className={mine.color ? 'named' : ''} style={nameStyle(mine.color)}>
              {settings?.profile.name}
            </b>
            <span>{mine.profile.status || t(`shell.role.${workspace?.role ?? 'admin'}`)}</span>
          </span>
        </PersonButton>
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

function QuotaBlock({ id, quota }: { id: string; quota: Quota }) {
  const { t } = useTranslation();
  // `claude-code` or `claude-code:<account>`: an extra login is named after its account.
  const [kind, accountId] = id.split(':') as [CliKind, string | undefined];
  const account = useApp((s) => (accountId ? s.accounts.find((a) => a.id === accountId) : undefined));
  const windows = Object.entries(quota.windows).sort(([a], [b]) => a.localeCompare(b));
  if (windows.length === 0) return null;
  const cli = t(`agent.kind.${kind}`);
  return (
    <div className="quota">
      <b>{t('quota.title', { cli: account ? `${cli} · ${account.name}` : cli })}</b>
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

/** On a phone with notifications not yet allowed: one tap turns pushes on. */
function PushBanner() {
  const { t } = useTranslation();
  const [state, setState] = useState(() => pushState());
  if (state !== 'off' || document.documentElement.dataset.phone !== '1') return null;
  return (
    <div className="pushbanner" role="status">
      <Icon name="alert" size={14} />
      <span className="grow">{t('phone.pushOff')}</span>
      <Button size="sm" variant="primary" onClick={async () => setState((await enablePush()) ? 'on' : pushState())}>
        {t('phone.pushOn')}
      </Button>
    </div>
  );
}

/** The bottom bar on a narrow screen (a phone): channels, tasks, waiting jobs, the crew, settings. */
function PhoneBar({ onSettings }: { onSettings: () => void }) {
  const { t } = useTranslation();
  const panel = useApp((s) => s.panel);
  const view = useApp((s) => s.view);
  const jobs = useApp((s) => s.jobs);
  const workspace = useApp((s) => s.workspace);
  const waiting = useMemo(
    () => Object.values(jobs).filter((j) => j.state === 'attention' && runsHere(j, workspace)),
    [jobs, workspace],
  );
  const toggle = (p: 'side' | 'crew') => useApp.setState({ panel: panel === p ? undefined : p });
  return (
    <nav className="phonebar" aria-label={t('phone.bar')}>
      <button type="button" className={panel === 'side' ? 'is-on' : ''} onClick={() => toggle('side')}>
        <Icon name="hash" size={18} />
        <span>{t('shell.channels')}</span>
      </button>
      <button
        type="button"
        className={view === 'tasks' && !panel ? 'is-on' : ''}
        onClick={() => useApp.getState().setView(view === 'tasks' ? 'channel' : 'tasks')}
      >
        <Icon name="tasks" size={18} />
        <span>{t('shell.tasks')}</span>
      </button>
      <button
        type="button"
        disabled={waiting.length === 0}
        onClick={() => {
          const first = waiting.sort((a, b) => a.started - b.started)[0];
          if (first) useApp.getState().openJob(first.id);
        }}
      >
        <Icon name="alert" size={18} />
        <span>
          {t('shell.waiting')}
          {waiting.length > 0 && ` ${waiting.length}`}
        </span>
      </button>
      <button type="button" className={panel === 'crew' ? 'is-on' : ''} onClick={() => toggle('crew')}>
        <Icon name="users" size={18} />
        <span>{t('shell.crew')}</span>
      </button>
      <button type="button" onClick={onSettings}>
        <Icon name="settings" size={18} />
        <span>{t('shell.settings')}</span>
      </button>
    </nav>
  );
}

/** What a working agent is doing right now: its running job's latest step. */
function stepText(jobs: Record<string, Job>, agentId: string, t: TFunction): string {
  const job = Object.values(jobs).find((j) => j.agentId === agentId && j.state === 'running');
  const step = job?.steps.at(-1);
  if (!step) return t('crew.running');
  const label = t(`job.tool.${step.label}`, step.label);
  return step.arg ? `${label} · ${step.arg}` : label;
}

/**
 * The crew as a strip of avatars: who is here and who is working, in the room one avatar takes. A click on an
 * agent opens its channel; the button on top opens the whole panel.
 */
function CrewStrip({ covered }: { covered: boolean }) {
  const { t } = useTranslation();
  const workspace = useApp((s) => s.workspace);
  const clis = useApp((s) => s.clis);
  const jobs = useApp((s) => s.jobs);
  const quota = useApp((s) => s.quota);
  const typing = useApp((s) => s.typing);
  const openChannel = useApp((s) => s.openChannel);
  const openAgentDialog = useApp((s) => s.openAgentDialog);
  const toggleCrew = useApp((s) => s.toggleCrew);
  const active = Object.values(jobs).filter((j) => j.state === 'running' || j.state === 'attention');
  const busy = new Set(active.map((j) => j.agentId));
  const asking = new Set(active.filter((j) => j.state === 'attention').map((j) => j.agentId));
  const agents = workspace?.agents ?? [];
  const advisors = workspace?.advisors ?? [];
  const members = workspace?.members ?? [];
  const me = workspace?.me;
  const waiting = (workspace?.joins?.length ?? 0) + (workspace?.lessons?.length ?? 0);
  return (
    <motion.aside
      className="strip"
      aria-label={t('shell.crew')}
      inert={covered}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
    >
      <button
        type="button"
        className="strip__open"
        aria-label={t('shell.expandCrew')}
        title={t('shell.expandCrew')}
        onClick={toggleCrew}
      >
        <Icon name="panelRight" size={16} />
        {waiting > 0 && <span className="strip__flag" aria-hidden="true" />}
      </button>
      {agents.length > 0 && (
        <ul className="strip__list">
          {agents.map((a) => {
            const owner = remoteOwner(a, workspace);
            const cli = clis?.find((c) => c.kind === a.kind);
            const missing = !owner && (!cli || cli.state === 'missing');
            const channel = workspace?.channels.find((c) => c.kind === 'agent' && c.agentId === a.id);
            const state = missing
              ? t('crew.cliMissing')
              : asking.has(a.id)
                ? t('job.approval.title')
                : busy.has(a.id)
                  ? stepText(jobs, a.id, t)
                  : owner
                    ? t('agent.on', { name: owner })
                    : t('crew.idle');
            const label = `${a.name} · ${state}`;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  className={`strip__who ${busy.has(a.id) ? 'is-busy' : ''} ${asking.has(a.id) ? 'is-asking' : ''} ${missing ? 'is-off' : ''}`}
                  aria-label={label}
                  title={label}
                  onClick={() => channel && void openChannel(channel.id)}
                >
                  <Avatar
                    name=""
                    icon={a.specialty ? specialistIcon(a) : 'terminal'}
                    size={32}
                    presence={missing ? 'off' : busy.has(a.id) ? 'busy' : 'on'}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {advisors.length > 0 && (
        <ul className="strip__list">
          {advisors.map((a) => {
            const writing = Object.values(typing).some((ids) => ids.includes(a.id));
            const label = `${a.name} · ${writing ? t('advisor.writing') : t(`advisorForm.personalities.${a.personality}`)}`;
            return (
              <li key={a.id}>
                <span className={`strip__who ${writing ? 'is-busy' : ''}`} role="img" aria-label={label} title={label}>
                  <Avatar name={a.name} size={32} presence={writing ? 'busy' : a.chatter === 'off' ? 'off' : 'on'} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <ul className="strip__list">
        {members.length > 0
          ? members.map((m) => {
              return (
                <li key={m.device}>
                  <PersonButton id={m.device} name={m.name} className={`strip__who ${m.online ? '' : 'is-off'}`}>
                    <PersonAvatar id={m.device} name={m.name} size={32} presence={m.online ? 'on' : 'off'} />
                  </PersonButton>
                </li>
              );
            })
          : me && (
              <li>
                <PersonButton id={me.id} name={me.name} className="strip__who">
                  <PersonAvatar id={me.id} name={me.name} size={32} presence="on" />
                </PersonButton>
              </li>
            )}
      </ul>
      <span className="grow" />
      {Object.entries(quota).map(([id, q]) => {
        const windows = Object.entries(q?.windows ?? {}).sort(([a], [b]) => a.localeCompare(b));
        if (windows.length === 0) return null;
        const top = Math.min(1, Math.max(...windows.map(([, w]) => w.used)));
        const label = `${t('quota.title', { cli: t(`agent.kind.${id.split(':')[0]}`) })} · ${windows
          .map(([name, w]) => `${t(`quota.window.${name}`, name)} %${Math.round(w.used * 100)}`)
          .join(' · ')}`;
        return (
          <span
            key={id}
            className={`strip__quota ${top >= 0.9 ? 'is-high' : ''}`}
            role="img"
            aria-label={label}
            title={label}
            style={{ '--used': top } as CSSProperties}
          >
            <span className="l-mono">{Math.round(top * 100)}</span>
          </span>
        );
      })}
      <IconButton size="sm" icon="plus" label={t('crew.addAgent')} onClick={() => openAgentDialog('new')} />
    </motion.aside>
  );
}

function Crew({ over = false }: { over?: boolean }) {
  const { t } = useTranslation();
  const workspace = useApp((s) => s.workspace);
  const clis = useApp((s) => s.clis);
  const jobs = useApp((s) => s.jobs);
  const quota = useApp((s) => s.quota);
  const openChannel = useApp((s) => s.openChannel);
  const openAgentDialog = useApp((s) => s.openAgentDialog);
  const openAdvisorDialog = useApp((s) => s.openAdvisorDialog);
  const answerJoin = useApp((s) => s.answerJoin);
  const setMemberRole = useApp((s) => s.setMemberRole);
  const removeMember = useApp((s) => s.removeMember);
  const typing = useApp((s) => s.typing);
  const openSpecialistDialog = useApp((s) => s.openSpecialistDialog);
  const settings = useApp((s) => s.settings);
  // Members in the order of the workspace's roles: whoever carries a role stands under it, the rest after.
  const groups = useMemo(() => {
    const members = workspace?.members ?? [];
    const roles = workspace?.roles ?? [];
    const first = (m: (typeof members)[number]) => roles.find((r) => m.roles?.[0] === r.id);
    return [
      ...roles.map((role) => ({ role, members: members.filter((m) => first(m)?.id === role.id) })),
      { role: undefined, members: members.filter((m) => !first(m)) },
    ].filter((g) => g.members.length > 0);
  }, [workspace?.members, workspace?.roles]);
  const everyAgent = workspace?.agents ?? [];
  const agents = everyAgent.filter((a) => !a.specialty);
  const specialists = everyAgent.filter((a) => a.specialty);
  const lessonsWaiting = workspace?.lessons ?? [];
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
  const doing = (agentId: string): string => stepText(jobs, agentId, t);
  const used = new Set(everyAgent.map((a) => a.kind));
  const suggestions = (clis ?? []).filter(
    (c) => RUNNABLE.includes(c.kind) && c.state !== 'missing' && !used.has(c.kind),
  );
  const me = workspace?.me;

  return (
    <motion.aside
      className={`crew ${over ? 'crew--over' : ''}`}
      aria-label={t('shell.crew')}
      initial={over ? { opacity: 0, x: 28 } : { opacity: 0 }}
      animate={
        over ? { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 460, damping: 38 } } : { opacity: 1 }
      }
      exit={
        over ? { opacity: 0, x: 28, transition: { duration: 0.14 } } : { opacity: 0, transition: { duration: 0.1 } }
      }
    >
      <div className="crew__head">
        <h2 className="grow">{t('shell.crew')}</h2>
        {/* A conversation with a friend is two people's: nobody is invited into it. */}
        {!workspace?.friend && (
          <Button size="sm" icon="userPlus" onClick={() => useApp.setState({ inviteOpen: true })}>
            {t('shell.invite')}
          </Button>
        )}
        <IconButton
          size="sm"
          icon="panelRight"
          className="crew__narrow"
          label={t(over ? 'shell.closeCrew' : 'shell.collapseCrew')}
          onClick={() => useApp.getState().toggleCrew()}
        />
      </div>
      <h3>
        <span className="grow">{t('shell.workers')}</span>
        <IconButton size="sm" icon="plus" label={t('crew.addAgent')} onClick={() => openAgentDialog('new')} />
      </h3>
      <motion.ul variants={stagger} initial="hidden" animate="shown" className="crew__list">
        {agents.map((a) => {
          const cli = clis?.find((c) => c.kind === a.kind);
          const owner = remoteOwner(a, workspace);
          // Another member's agent runs on their computer: this computer's CLIs do not matter for it.
          const missing = !owner && (!cli || cli.state === 'missing');
          const channel = workspace?.channels.find((c) => c.kind === 'agent' && c.agentId === a.id);
          const state = missing
            ? t('crew.cliMissing')
            : asking.has(a.id)
              ? t('job.approval.title')
              : busy.has(a.id)
                ? doing(a.id)
                : t('crew.idle');
          return (
            <motion.li key={a.id} variants={popIn} className={`who ${missing ? 'is-off' : ''}`}>
              <button type="button" className="who__open" onClick={() => channel && void openChannel(channel.id)}>
                <Avatar name="" icon="terminal" size={28} presence={missing ? 'off' : busy.has(a.id) ? 'busy' : 'on'} />
                <div className="who__text">
                  <b>
                    {a.name} <span className="l-mono">@{a.handle}</span>
                  </b>
                  <span className={busy.has(a.id) && !owner ? 'who__doing' : ''}>
                    {busy.has(a.id) && !owner
                      ? state
                      : `${t(`agent.kind.${a.kind}`)} · ${owner ? t('agent.on', { name: owner }) : state}`}
                  </span>
                </div>
              </button>
              {!owner && (
                <IconButton size="sm" icon="settings" label={t('agentForm.edit')} onClick={() => openAgentDialog(a)} />
              )}
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
        <span className="grow">{t('shell.specialists')}</span>
        <IconButton size="sm" icon="plus" label={t('specialists.new')} onClick={() => openSpecialistDialog('new')} />
      </h3>
      {specialists.length === 0 ? (
        <button type="button" className="crew__empty" onClick={() => openSpecialistDialog('new')}>
          {t('shell.noSpecialists')}
        </button>
      ) : (
        <motion.ul variants={stagger} initial="hidden" animate="shown" className="crew__list">
          {specialists.map((a) => {
            const cli = clis?.find((c) => c.kind === a.kind);
            const owner = remoteOwner(a, workspace);
            const missing = !owner && (!cli || cli.state === 'missing');
            const channel = workspace?.channels.find((c) => c.kind === 'agent' && c.agentId === a.id);
            const learned = (a.specialty?.lessons ?? '').split('\n').filter((l) => l.trim()).length;
            const waiting = lessonsWaiting.filter((l) => l.agentId === a.id).length;
            return (
              <motion.li key={a.id} variants={popIn} className={`who who--spec ${missing ? 'is-off' : ''}`}>
                <button
                  type="button"
                  className="who__open"
                  title={a.specialty?.role}
                  onClick={() => channel && void openChannel(channel.id)}
                >
                  <Avatar
                    name=""
                    icon={specialistIcon(a)}
                    size={28}
                    presence={missing ? 'off' : busy.has(a.id) ? 'busy' : 'on'}
                  />
                  <div className="who__text">
                    <b>
                      {a.name} <span className="l-mono">@{a.handle}</span>
                    </b>
                    <span className={busy.has(a.id) ? 'who__doing' : ''}>
                      {asking.has(a.id)
                        ? t('job.approval.title')
                        : busy.has(a.id)
                          ? doing(a.id)
                          : owner
                            ? t('agent.on', { name: owner })
                            : a.specialty?.role}
                    </span>
                  </div>
                </button>
                {learned > 0 && (
                  <span className="who__learned l-mono" title={t('specialists.learned', { count: learned })}>
                    <Icon name="cap" size={12} />
                    {learned}
                  </span>
                )}
                {waiting > 0 && (
                  <span className="badge-count" title={t('specialists.lessons.pending')}>
                    {waiting}
                  </span>
                )}
                {!owner && (
                  <IconButton
                    size="sm"
                    icon="settings"
                    label={t('specialists.edit')}
                    onClick={() => openAgentDialog(a)}
                  />
                )}
              </motion.li>
            );
          })}
        </motion.ul>
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
      {(workspace?.joins?.length ?? 0) > 0 && (
        <>
          <h3>{t('invite.requests')}</h3>
          <ul className="crew__list joins" aria-label={t('invite.requests')}>
            {workspace?.joins?.map((j) => (
              <li key={j.id} className="join">
                <div className="who__text">
                  <b>{j.name}</b>
                  <span>{t('invite.asks', { role: t(`shell.role.${j.role}`) })}</span>
                </div>
                <Button size="sm" variant="quiet" onClick={() => void answerJoin(j.id, false)}>
                  {t('invite.deny')}
                </Button>
                <Button size="sm" variant="primary" onClick={() => void answerJoin(j.id, true)}>
                  {t('invite.approve')}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>
        <span className="grow">{t('shell.members')}</span>
        <span className="l-mono">{workspace?.members?.length ?? 1}</span>
      </h3>
      {workspace?.members ? (
        <ul className="crew__list" aria-label={t('shell.members')}>
          {groups.flatMap((g) => [
            ...(g.role && groups.length > 1
              ? [
                  <li key={`role-${g.role.id}`} className="crew__group" style={nameStyle(g.role.color)}>
                    <span className="rolechip__dot" aria-hidden="true" />
                    <span className="grow">{g.role.name}</span>
                    <span className="l-mono">{g.members.length}</span>
                  </li>,
                ]
              : []),
            ...g.members.map((m) => {
              const color = personOf(workspace, settings, m.device).color;
              return (
                <li key={m.device} className={`who who--member ${m.online ? '' : 'is-away'}`}>
                  <PersonButton id={m.device} name={m.name} className="who__open">
                    <PersonAvatar id={m.device} name={m.name} size={28} presence={m.online ? 'on' : 'off'} />
                    <span className="who__text">
                      <b className={color ? 'named' : ''} style={nameStyle(color)}>
                        {m.name}
                        {m.me && <span className="muted"> · {t('members.me')}</span>}
                      </b>
                      <span>{m.profile?.status || t(`shell.role.${m.role}`)}</span>
                    </span>
                  </PersonButton>
                  {workspace.role === 'admin' && !m.me && !workspace.friend && (
                    <>
                      <select
                        className="l-input member__role"
                        aria-label={t('members.role', { name: m.name })}
                        value={m.role}
                        onChange={(e) => void setMemberRole(m.device, e.target.value as MemberRole)}
                      >
                        {MEMBER_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {t(`shell.role.${r}`)}
                          </option>
                        ))}
                      </select>
                      <IconButton
                        size="sm"
                        icon="trash"
                        label={t('members.remove', { name: m.name })}
                        onClick={() => void removeMember(m.device)}
                      />
                    </>
                  )}
                </li>
              );
            }),
          ])}
        </ul>
      ) : (
        <div className="who">
          <PersonButton id={me?.id ?? ''} name={me?.name ?? ''} className="who__open">
            <PersonAvatar id={me?.id ?? ''} name={me?.name ?? ''} size={28} presence="on" />
            <span className="who__text">
              <b>{me?.name}</b>
              <span>{settings?.profile.status || t('shell.role.admin')}</span>
            </span>
          </PersonButton>
        </div>
      )}
      <span className="grow" />
      {Object.entries(quota).map(([id, q]) => q && <QuotaBlock key={id} id={id} quota={q} />)}
    </motion.aside>
  );
}

export function Shell({ onSettings }: { onSettings: () => void }) {
  const view = useApp((s) => s.view);
  const channel = useApp((s) => s.workspace?.channels.find((c) => c.id === s.channelId));
  const watching = useApp((s) => s.watching);
  const panel = useApp((s) => s.panel);
  const { t } = useTranslation();
  const sidebar = useApp((s) => s.settings?.sidebar !== false);
  const crew = useApp((s) => s.settings?.crew ?? 'panel');
  const peek = useApp((s) => s.crewPeek === true);
  const phone = useMedia(PHONE);
  const wide = useMedia(WIDE);
  // Beside the page there is room for the panel (or the live view) only in a wide window; a phone has its own
  // layout. In between, the strip stands there and the panel or the live view opens over the page.
  const beside = phone || wide;
  const strip = !phone && (!wide || crew === 'strip');
  const over = beside ? undefined : watching ? 'live' : peek ? 'crew' : undefined;
  useTaskbar();

  useEffect(() => {
    if (beside && peek) useApp.setState({ crewPeek: false });
  }, [beside, peek]);
  useEffect(() => {
    if (over !== 'crew') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useApp.setState({ crewPeek: false });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [over]);

  return (
    <motion.div
      data-panel={panel}
      data-side={sidebar ? undefined : 'off'}
      className="shell"
      initial={{ opacity: 0, scale: 1.01 }}
      animate={{ opacity: 1, scale: 1, transition: { duration: 0.3 } }}
    >
      <Rail onSettings={onSettings} />
      <Sidebar onSettings={onSettings} />
      {view === 'channel' && channel ? (
        <ChannelView key={channel.id} channel={channel} />
      ) : view === 'home' ? (
        <OverviewView onSettings={onSettings} />
      ) : view === 'tasks' ? (
        <Board />
      ) : view === 'goals' ? (
        <GoalsView />
      ) : view === 'routines' ? (
        <RoutinesView />
      ) : view === 'memory' ? (
        <MemoryView />
      ) : view === 'project' ? (
        <ProjectPage />
      ) : view === 'ideas' || view === 'references' || view === 'commands' ? (
        <RecordsView key={view} kind={view === 'ideas' ? 'idea' : view === 'references' ? 'reference' : 'command'} />
      ) : (
        <Placeholder view={view} />
      )}
      <AnimatePresence mode="wait">
        {beside && watching ? (
          <LiveView key={watching} jobId={watching} />
        ) : strip ? (
          <CrewStrip key="strip" covered={over === 'crew'} />
        ) : (
          <Crew key="crew" />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {over === 'live' && watching && <LiveView key={`over-${watching}`} jobId={watching} over />}
        {over === 'crew' && (
          <motion.button
            key="scrim"
            type="button"
            className="shell__scrim"
            aria-label={t('shell.closeCrew')}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => useApp.setState({ crewPeek: false })}
          />
        )}
        {over === 'crew' && <Crew key="crew-over" over />}
      </AnimatePresence>
      <PushBanner />
      <PhoneBar onSettings={onSettings} />
    </motion.div>
  );
}
