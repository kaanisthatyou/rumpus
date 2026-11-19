// The channel list in the sidebar: channels and agents' channels, and the groups they are sorted into ("Create
// group"). Groups are the workspace's, like Discord's categories: every member sees the same ones and an admin
// arranges them; whether a group is closed is each person's own. A channel moves into a group by dragging it there
// or from its right-click menu.
import type { Channel, ChannelGroup } from '@lonca/protocol';
import { Icon, IconButton, type IconName } from '@lonca/ui';
import { motion } from 'motion/react';
import { type ButtonHTMLAttributes, type DragEvent, type MouseEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { remoteOwner } from '../agents/owner';
import { specialistIcon } from '../agents/SpecialistDialog';
import { type MenuItem, useApp } from '../store';
import { openMenu } from './ContextMenu';

/** What a dragged channel carries. */
const DRAG = 'application/x-lonca-channel';
const NO_GROUPS: ChannelGroup[] = [];

export function NavButton({
  on,
  icon,
  label,
  onClick,
  badge,
  unread,
  className,
  ...rest
}: {
  on: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
  badge?: boolean;
  /** Messages that arrived since the channel was last open; `mention` when one of them names this person. */
  unread?: { count: number; mention?: boolean };
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type'>) {
  return (
    <button
      type="button"
      className={`nav ${on ? 'is-on' : ''} ${unread ? 'is-unread' : ''} ${className ?? ''}`}
      aria-current={on ? 'page' : undefined}
      onClick={onClick}
      {...rest}
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
      {unread && <UnreadCount unread={unread} />}
    </button>
  );
}

function UnreadCount({ unread }: { unread: { count: number; mention?: boolean } }) {
  const { t } = useTranslation();
  return (
    <span
      className={`nav__unread ${unread.mention ? 'is-mention' : ''}`}
      title={t(unread.mention ? 'channel.unreadMention' : 'channel.unread', { count: unread.count })}
    >
      {unread.mention ? '@' : ''}
      {unread.count > 99 ? '99+' : unread.count}
    </span>
  );
}

const dragged = (e: DragEvent): boolean => e.dataTransfer.types.includes(DRAG);

/** A name typed in place (a new group, a group's or a channel's new name): Enter keeps it, Esc and leaving drop it. */
function NameField({
  label,
  placeholder,
  initial = '',
  onDone,
  onCancel,
}: {
  label: string;
  placeholder?: string;
  initial?: string;
  onDone: (name: string) => Promise<boolean> | boolean;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <form
      className="side__new"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return onCancel();
        if (await onDone(name.trim())) onCancel();
      }}
    >
      <input
        className="l-input"
        // biome-ignore lint/a11y/noAutofocus: the field opens on request, typing is the next step
        autoFocus
        value={name}
        maxLength={40}
        aria-label={label}
        placeholder={placeholder}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        onBlur={onCancel}
      />
    </form>
  );
}

/** Takes rules off the start and the end of a menu and never puts two together. */
function tidy(items: MenuItem[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const item of items) {
    if ('rule' in item && (out.length === 0 || 'rule' in (out.at(-1) ?? {}))) continue;
    out.push(item);
  }
  while (out.length > 0 && 'rule' in (out.at(-1) ?? {})) out.pop();
  return out;
}

export function ChannelList() {
  const { t } = useTranslation();
  const workspace = useApp((s) => s.workspace);
  const closedIds = useApp((s) => s.settings?.closedGroups);
  const view = useApp((s) => s.view);
  const channelId = useApp((s) => s.channelId);
  const jobs = useApp((s) => s.jobs);
  const unread = useApp((s) => s.unread);
  const openChannel = useApp((s) => s.openChannel);
  const createChannel = useApp((s) => s.createChannel);
  const [creating, setCreating] = useState(false);
  /** A new group is being named; with a channel id, that channel goes into it. */
  const [naming, setNaming] = useState<{ with?: string }>();
  const [renaming, setRenaming] = useState<{ group?: string; channel?: string }>();
  /** Where a dragged channel would land: a group's id, or `''` for the list outside any group. */
  const [drop, setDrop] = useState<{ group: string; before?: string }>();

  const groups = workspace?.groups ?? NO_GROUPS;
  const closed = useMemo(() => new Set(closedIds ?? []), [closedIds]);
  const listed = useMemo(
    () => (workspace?.channels ?? []).filter((c) => c.kind === 'channel' || c.kind === 'agent'),
    [workspace?.channels],
  );
  const byId = useMemo(() => new Map(listed.map((c) => [c.id, c])), [listed]);
  const groupOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) for (const id of g.channels) if (!map.has(id)) map.set(id, g.id);
    return map;
  }, [groups]);
  const loose = listed.filter((c) => c.kind === 'channel' && !groupOf.has(c.id));
  const looseAgents = listed.filter((c) => c.kind === 'agent' && !groupOf.has(c.id));
  const running = useMemo(
    () =>
      new Set(
        Object.values(jobs)
          .filter((j) => j.state === 'running')
          .map((j) => j.channelId),
      ),
    [jobs],
  );
  const manage = workspace?.kind === 'personal' || workspace?.role === 'admin';
  const plain = listed.filter((c) => c.kind === 'channel').length;

  const save = (next: ChannelGroup[]) => {
    if (!manage) return;
    // Channels that are gone, and a channel in two groups, are dropped while saving.
    const seen = new Set<string>();
    const clean = next.map((g) => ({
      ...g,
      channels: g.channels.filter((id) => byId.has(id) && !seen.has(id) && seen.add(id)),
    }));
    void useApp.getState().saveGroups(clean);
  };
  /** Opens or closes a group for this person only; ids of groups that are gone are dropped. */
  const toggle = (id: string) => {
    const known = new Set(groups.map((g) => g.id));
    const rest = [...closed].filter((x) => x !== id && known.has(x));
    void useApp.getState().patch({ closedGroups: closed.has(id) ? rest : [...rest, id] });
  };
  const change = (id: string, fn: (g: ChannelGroup) => ChannelGroup) =>
    save(groups.map((g) => (g.id === id ? fn(g) : g)));
  const move = (channel: string, group: string | undefined, before?: string) => {
    save(
      groups.map((g) => {
        const rest = g.channels.filter((id) => id !== channel);
        if (g.id !== group) return { ...g, channels: rest };
        const at = before ? rest.indexOf(before) : -1;
        return { ...g, channels: at < 0 ? [...rest, channel] : [...rest.slice(0, at), channel, ...rest.slice(at)] };
      }),
    );
  };
  const addGroup = (name: string, first?: string) => {
    const group: ChannelGroup = {
      id: crypto.randomUUID(),
      name: name.slice(0, 40),
      channels: [],
    };
    const next = [...groups.map((g) => ({ ...g, channels: g.channels.filter((id) => id !== first) })), group];
    if (first) group.channels.push(first);
    save(next);
    return true;
  };
  const shift = (id: string, by: -1 | 1) => {
    const at = groups.findIndex((g) => g.id === id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= groups.length) return;
    const next = [...groups];
    [next[at], next[to]] = [next[to] as ChannelGroup, next[at] as ChannelGroup];
    save(next);
  };

  const askDelete = (c: Channel) =>
    useApp.setState({
      confirm: {
        title: t('channel.deleteTitle', { name: c.name }),
        body: t('channel.deleteBody'),
        action: t('channel.deleteAction'),
        run: () => useApp.getState().deleteChannel(c.id),
      },
      error: undefined,
    });

  const channelMenu = (e: MouseEvent<HTMLElement>, c: Channel) => {
    const agent = c.kind === 'agent' ? workspace?.agents.find((a) => a.id === c.agentId) : undefined;
    const inGroup = groupOf.get(c.id);
    const label = c.kind === 'agent' ? `@${c.name}` : `#${c.name}`;
    openMenu(
      e,
      t('groups.menuOf', { name: label }),
      tidy([
        { label: t('groups.open'), icon: c.kind === 'agent' ? 'terminal' : 'hash', run: () => void openChannel(c.id) },
        ...(unread[c.id]
          ? [{ label: t('groups.markRead'), icon: 'check' as const, run: () => useApp.getState().markRead(c.id) }]
          : []),
        { rule: true },
        ...(manage
          ? [
              { heading: t('groups.moveTo') },
              ...groups.map((g) => ({
                label: g.name,
                icon: 'folder' as const,
                checked: inGroup === g.id,
                run: () => move(c.id, g.id),
              })),
              ...(groups.length > 0
                ? [{ label: t('groups.none'), checked: !inGroup, run: () => move(c.id, undefined) }]
                : []),
              { label: t('groups.newWith'), icon: 'plus' as const, run: () => setNaming({ with: c.id }) },
              { rule: true as const },
            ]
          : []),
        ...(c.kind === 'channel' && manage
          ? [{ label: t('groups.renameChannel'), icon: 'pencil' as const, run: () => setRenaming({ channel: c.id }) }]
          : []),
        ...(agent && !remoteOwner(agent, workspace)
          ? [
              {
                label: t('groups.agentSettings'),
                icon: 'settings' as const,
                run: () => useApp.getState().openAgentDialog(agent),
              },
            ]
          : []),
        ...(c.kind === 'channel' && manage && plain > 1
          ? [
              { rule: true as const },
              { label: t('channel.deleteAction'), icon: 'trash' as const, danger: true, run: () => askDelete(c) },
            ]
          : []),
      ]),
    );
  };

  const groupMenu = (e: MouseEvent<HTMLElement>, g: ChannelGroup, index: number) => {
    const ids = g.channels.filter((id) => byId.has(id));
    const someUnread = ids.some((id) => unread[id]);
    const shut = closed.has(g.id);
    openMenu(
      e,
      t('groups.menuOf', { name: g.name }),
      tidy([
        {
          label: t(shut ? 'groups.expand' : 'groups.collapse'),
          icon: shut ? 'chevronRight' : 'chevronDown',
          run: () => toggle(g.id),
        },
        ...(someUnread
          ? [
              {
                label: t('groups.markAllRead'),
                icon: 'check' as const,
                run: () => {
                  for (const id of ids) if (useApp.getState().unread[id]) useApp.getState().markRead(id);
                },
              },
            ]
          : []),
        ...(manage
          ? [
              { rule: true as const },
              { label: t('groups.rename'), icon: 'pencil' as const, run: () => setRenaming({ group: g.id }) },
              ...(index > 0 ? [{ label: t('groups.moveUp'), run: () => shift(g.id, -1) }] : []),
              ...(index < groups.length - 1 ? [{ label: t('groups.moveDown'), run: () => shift(g.id, 1) }] : []),
              { rule: true as const },
              {
                label: t('groups.delete'),
                icon: 'trash' as const,
                danger: true,
                run: () => save(groups.filter((x) => x.id !== g.id)),
              },
            ]
          : []),
      ]),
    );
  };

  /** A drop zone: a group (by id) or the list outside groups (`''`). */
  const zone = (group: string) => ({
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (!manage || !dragged(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (drop?.group !== group || drop.before) setDrop({ group });
    },
    onDragLeave: (e: DragEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(undefined);
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      const id = e.dataTransfer.getData(DRAG);
      setDrop(undefined);
      if (!id) return;
      e.preventDefault();
      move(id, group || undefined);
    },
  });

  const row = (c: Channel, group?: string) => {
    if (renaming?.channel === c.id)
      return (
        <NameField
          key={c.id}
          label={t('groups.renameChannel')}
          initial={c.name}
          onDone={(name) => useApp.getState().renameChannel(c.id, name)}
          onCancel={() => setRenaming(undefined)}
        />
      );
    const agent = c.kind === 'agent' ? workspace?.agents.find((a) => a.id === c.agentId) : undefined;
    const icon: IconName = c.kind === 'agent' ? (agent?.specialty ? specialistIcon(agent) : 'terminal') : 'hash';
    return (
      <NavButton
        key={c.id}
        on={view === 'channel' && channelId === c.id}
        icon={icon}
        label={c.kind === 'agent' ? `@${c.name}` : c.name}
        badge={running.has(c.id)}
        {...(unread[c.id] ? { unread: unread[c.id] } : {})}
        className={drop && group && drop.group === group && drop.before === c.id ? 'is-dropbefore' : ''}
        draggable={manage}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG, c.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => setDrop(undefined)}
        {...(group
          ? {
              onDragOver: (e: DragEvent<HTMLButtonElement>) => {
                if (!manage || !dragged(e)) return;
                e.preventDefault();
                e.stopPropagation();
                if (drop?.group !== group || drop.before !== c.id) setDrop({ group, before: c.id });
              },
              onDrop: (e: DragEvent<HTMLButtonElement>) => {
                const id = e.dataTransfer.getData(DRAG);
                setDrop(undefined);
                if (!id) return;
                e.preventDefault();
                e.stopPropagation();
                if (id !== c.id) move(id, group, c.id);
              },
            }
          : {})}
        onContextMenu={(e) => channelMenu(e, c)}
        onClick={() => void openChannel(c.id)}
      />
    );
  };

  return (
    <>
      <div className={`grp ${drop?.group === '' ? 'is-drop' : ''}`} {...zone('')}>
        <h2>
          <span className="grow">{t('shell.channels')}</span>
          {manage && (
            <IconButton
              size="sm"
              icon="folder"
              label={t('groups.create')}
              onClick={() => setNaming((v) => (v ? undefined : {}))}
            />
          )}
          <IconButton size="sm" icon="plus" label={t('channel.create')} onClick={() => setCreating((v) => !v)} />
        </h2>
        {creating && (
          <NameField
            label={t('channel.create')}
            placeholder={t('channel.namePlaceholder')}
            onDone={(name) => createChannel(name)}
            onCancel={() => setCreating(false)}
          />
        )}
        {naming && (
          <NameField
            label={t('groups.create')}
            placeholder={t('groups.namePlaceholder')}
            onDone={(name) => addGroup(name, naming.with)}
            onCancel={() => setNaming(undefined)}
          />
        )}
        {loose.map((c) => row(c))}
      </div>
      {groups.map((g, index) => {
        const inside = g.channels.map((id) => byId.get(id)).filter((c): c is Channel => Boolean(c));
        const shut = closed.has(g.id);
        // A closed group still shows the channel on screen, as its only line.
        const shown = shut ? inside.filter((c) => view === 'channel' && c.id === channelId) : inside;
        const missed = shut
          ? inside.reduce(
              (sum, c) => {
                const u = unread[c.id];
                return u ? { count: sum.count + u.count, mention: sum.mention || Boolean(u.mention) } : sum;
              },
              { count: 0, mention: false },
            )
          : undefined;
        return (
          <div
            key={g.id}
            className={`grp cgrp ${shut ? 'is-collapsed' : ''} ${drop?.group === g.id && !drop.before ? 'is-drop' : ''}`}
            {...zone(g.id)}
          >
            {renaming?.group === g.id ? (
              <NameField
                label={t('groups.rename')}
                initial={g.name}
                onDone={(name) => {
                  change(g.id, (x) => ({ ...x, name: name.slice(0, 40) }));
                  return true;
                }}
                onCancel={() => setRenaming(undefined)}
              />
            ) : (
              <h2>
                <button
                  type="button"
                  className="cgrp__head"
                  aria-expanded={!shut}
                  onClick={() => toggle(g.id)}
                  onContextMenu={(e) => groupMenu(e, g, index)}
                >
                  <span className="cgrp__chev" aria-hidden="true">
                    <Icon name="chevronDown" size={12} />
                  </span>
                  <span className="grow">{g.name}</span>
                  {missed && missed.count > 0 && <UnreadCount unread={missed} />}
                </button>
              </h2>
            )}
            {shown.map((c) => row(c, g.id))}
            {!shut && inside.length === 0 && <p className="cgrp__empty">{t('groups.empty')}</p>}
          </div>
        );
      })}
      {looseAgents.length > 0 && (
        <div className={`grp ${drop?.group === '' ? 'is-drop' : ''}`} {...zone('')}>
          <h2>{t('channel.agents')}</h2>
          {looseAgents.map((c) => row(c))}
        </div>
      )}
    </>
  );
}
