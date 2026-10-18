import type { Advisor, Agent, Channel, Job, Message } from '@lonca/protocol';
import { Avatar, Button, Chip, Icon, IconButton, Kbd } from '@lonca/ui';
import { AnimatePresence, motion } from 'motion/react';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fillCommand, RefImage, readImage } from '../records/RecordsView';
import { useApp } from '../store';
import { clock, dayKey, dayLabel } from './format';
import { JobCard } from './JobCard';
import { Markdown } from './Markdown';

const EMPTY: Message[] = [];
const NO_ADVISORS: Advisor[] = [];
const NO_REFS: string[] = [];

/** A record attached to a message or to the message being written. */
function RefChip({ id, onRemove }: { id: string; onRemove?: () => void }) {
  const { t } = useTranslation();
  const record = useApp((s) => s.records.find((r) => r.id === id));
  if (!record) return null;
  return (
    <span className="refchip">
      {record.kind === 'reference' ? (
        <RefImage id={record.id} className="refchip__thumb" />
      ) : (
        <Icon name={record.kind === 'idea' ? 'idea' : 'bookmark'} size={13} />
      )}
      <span className="refchip__title">{record.title}</span>
      {onRemove && (
        <button type="button" className="refchip__x" aria-label={t('records.remove')} onClick={onRemove}>
          <Icon name="close" size={11} />
        </button>
      )}
    </span>
  );
}

function MessageRow({ message, agents, jobs }: { message: Message; agents: Agent[]; jobs: Job[] }) {
  const { t } = useTranslation();
  const me = useApp((s) => s.workspace?.me.id);
  const editMessage = useApp((s) => s.editMessage);
  const deleteMessage = useApp((s) => s.deleteMessage);
  const saveRecord = useApp((s) => s.saveRecord);
  const flash = useApp((s) => s.flash);
  const [editing, setEditing] = useState(false);
  const saveIdea = async () => {
    const first = message.text.trim().split('\n')[0] ?? '';
    const saved = await saveRecord({
      kind: 'idea',
      title: first.length > 80 ? `${first.slice(0, 80)}…` : first || '—',
      body: message.text,
      sourceId: message.id,
    });
    if (saved) flash(t('records.saved'));
  };
  const [draft, setDraft] = useState(message.text);
  const a = message.author;
  const own = a.kind === 'person' && a.id === me;
  // An advisor's suggested task (`/todo …`) is already a board card: shown as a line of its own.
  const { body, todos } = useMemo(() => {
    if (a.kind !== 'advisor') return { body: message.text, todos: [] as string[] };
    const lines = message.text.split('\n');
    const tasks = lines.flatMap((l) => /^\/todo\s+(.+)$/.exec(l.trim())?.[1] ?? []);
    return { body: lines.filter((l) => !/^\/todo\s+/.test(l.trim())).join('\n'), todos: tasks };
  }, [a.kind, message.text]);
  const name = a.kind === 'system' ? 'Lonca' : a.name;
  const agent = a.kind === 'agent' ? agents.find((x) => x.id === a.id) : undefined;
  const advisor = useApp((s) => (a.kind === 'advisor' ? s.workspace?.advisors.find((x) => x.id === a.id) : undefined));

  return (
    <motion.article
      className={`msg msg--${a.kind}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: { type: 'spring', stiffness: 420, damping: 32 } }}
    >
      <Avatar name={name} size={32} {...(a.kind === 'agent' ? { icon: 'terminal' as const } : {})} />
      <div className="msg__body">
        <div className="msg__meta">
          <b>{name}</b>
          {agent && <Chip mono>@{agent.handle}</Chip>}
          {advisor && <Chip mono>@{advisor.handle}</Chip>}
          {a.kind === 'advisor' && <span className="msg__role">{t('advisor.role')}</span>}
          <time className="l-mono">{clock(message.created)}</time>
          {message.edited && <span className="msg__edited">{t('channel.edited')}</span>}
          {!editing && (
            <span className="msg__actions">
              <IconButton size="sm" icon="idea" label={t('records.saveMessage')} onClick={() => void saveIdea()} />
              {own && (
                <>
                  <IconButton size="sm" icon="pencil" label={t('channel.edit')} onClick={() => setEditing(true)} />
                  <IconButton
                    size="sm"
                    icon="trash"
                    label={t('channel.delete')}
                    onClick={() => void deleteMessage(message.id)}
                  />
                </>
              )}
            </span>
          )}
        </div>
        {editing ? (
          <form
            className="msg__edit"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await editMessage(message.id, draft)) setEditing(false);
            }}
          >
            <textarea
              className="l-input"
              value={draft}
              // biome-ignore lint/a11y/noAutofocus: edit mode opens on request and typing is the next step
              autoFocus
              aria-label={t('channel.edit')}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false);
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="msg__editbar">
              <Button size="sm" variant="quiet" onClick={() => setEditing(false)}>
                {t('channel.cancel')}
              </Button>
              <Button size="sm" variant="primary" type="submit">
                {t('channel.save')}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <Markdown text={body} />
            {todos.map((task) => (
              <div key={task} className="msg__todo">
                <Icon name="tasks" size={13} />
                <span>{t('advisor.suggested')}</span>
                <b>{task}</b>
              </div>
            ))}
          </>
        )}
        {message.refs?.length ? (
          <div className="msg__refs">
            {message.refs.map((id) => (
              <RefChip key={id} id={id} />
            ))}
          </div>
        ) : null}
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} agent={agents.find((x) => x.id === job.agentId)} />
        ))}
      </div>
    </motion.article>
  );
}

function Typing({ channelId }: { channelId: string }) {
  const { t } = useTranslation();
  const ids = useApp((s) => s.typing[channelId] ?? NO_REFS);
  const advisors = useApp((s) => s.workspace?.advisors ?? NO_ADVISORS);
  const names = ids.map((id) => advisors.find((a) => a.id === id)?.name).filter(Boolean);
  return (
    <AnimatePresence>
      {names.length > 0 && (
        <motion.div
          className="typing"
          role="status"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
        >
          <span className="typing__dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {t('advisor.typing', { names: names.join(', ') })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface Suggestion {
  key: string;
  insert: string;
  label: string;
  detail: string;
  icon: 'terminal' | 'chevronRight' | 'chat';
}

function Composer({ channel, agents }: { channel: Channel; agents: Agent[] }) {
  const { t } = useTranslation();
  const send = useApp((s) => s.send);
  const createCard = useApp((s) => s.createCard);
  const newSession = useApp((s) => s.newSession);
  const council = useApp((s) => s.council);
  const advisors = useApp((s) => s.workspace?.advisors ?? NO_ADVISORS);
  const flash = useApp((s) => s.flash);
  const note = useApp((s) => s.note);
  const attached = useApp((s) => s.attached[channel.id] ?? NO_REFS);
  const records = useApp((s) => s.records);
  const attach = useApp((s) => s.attach);
  const detach = useApp((s) => s.detach);
  const saveRecord = useApp((s) => s.saveRecord);
  const inject = useApp((s) => s.inject);
  const [picking, setPicking] = useState(false);
  const me = useApp((s) => s.workspace?.me);
  const tiles = records.filter((r) => r.kind === 'command' && r.pinned);
  const [pickQuery, setPickQuery] = useState('');
  const [text, setText] = useState('');
  const [pick, setPick] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const own = channel.kind === 'agent' ? agents.find((a) => a.id === channel.agentId) : undefined;

  // `@` at the caret lists agents; `/` at the start lists commands.
  const caret = ref.current?.selectionStart ?? text.length;
  const mention = /(^|\s)@([a-z0-9-]*)$/.exec(text.slice(0, caret));
  const command = /^\/([a-z-]*)$/.exec(text.slice(0, caret));
  const commands: Suggestion[] = [
    { key: 'todo', insert: '/todo ', label: '/todo', detail: t('commands.todo'), icon: 'chevronRight' },
    ...(channel.kind === 'channel'
      ? [{ key: 'meclis', insert: '/meclis ', label: '/meclis', detail: t('commands.council'), icon: 'chat' as const }]
      : []),
    ...(own
      ? [
          {
            key: 'new',
            insert: '/yeni-oturum',
            label: '/yeni-oturum',
            detail: t('commands.newSession'),
            icon: 'chevronRight' as const,
          },
        ]
      : []),
  ];
  const options: Suggestion[] = mention
    ? [
        ...agents.map((a) => ({ key: a.id, handle: a.handle, detail: a.name, icon: 'terminal' as const })),
        ...(channel.kind === 'channel' ? advisors : []).map((a) => ({
          key: a.id,
          handle: a.handle,
          detail: a.name,
          icon: 'chat' as const,
        })),
      ]
        .filter((x) => x.handle.startsWith(mention[2] ?? ''))
        .slice(0, 8)
        .map((x) => ({ key: x.key, insert: `@${x.handle} `, label: `@${x.handle}`, detail: x.detail, icon: x.icon }))
    : command
      ? commands.filter((c) => c.label.startsWith(`/${command[1] ?? ''}`))
      : [];

  // A suggestion typed out in full: Enter sends instead of completing it again.
  const exact = options.length === 1 && text.slice(0, caret).endsWith(options[0]?.insert.trim() ?? '\u0000');

  // A saved command put into the box from the records view.
  useEffect(() => {
    if (!inject) return;
    setText((prev) => (prev.trim() ? `${prev}\n${inject.text}` : inject.text));
    useApp.setState({ inject: undefined });
    requestAnimationFrame(() => ref.current?.focus());
  }, [inject]);

  const pasteImages = async (files: File[]) => {
    for (const file of files.filter((f) => f.type.startsWith('image/'))) {
      const img = await readImage(file);
      const saved = await saveRecord({
        kind: 'reference',
        title: `${t('records.pasted')} ${new Date().toLocaleTimeString().slice(0, 5)}`,
        imageData: img.dataUrl,
        width: img.width,
        height: img.height,
      });
      if (saved) attach(saved.id);
    }
  };

  const pickable = records
    .filter((r) => !attached.includes(r.id))
    .filter(
      (r) =>
        !pickQuery.trim() || `${r.title} ${r.tags.join(' ')}`.toLowerCase().includes(pickQuery.trim().toLowerCase()),
    )
    .slice(0, 8);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  });

  const insert = (s: Suggestion) => {
    const typed = mention ? (mention[2]?.length ?? 0) + 1 : command ? (command[1]?.length ?? 0) + 1 : 0;
    const start = caret - typed;
    const next = `${text.slice(0, start)}${s.insert}${text.slice(caret)}`;
    setText(next);
    setPick(0);
    requestAnimationFrame(() => {
      const pos = start + s.insert.length;
      ref.current?.setSelectionRange(pos, pos);
      ref.current?.focus();
    });
  };

  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    const todo = /^\/todo\s+([\s\S]+)$/.exec(value);
    if (todo?.[1]) {
      const body = todo[1];
      const handle = /(^|\s)@([a-z0-9][a-z0-9-]*)/.exec(body)?.[2];
      const title = body.replace(/(^|\s)@[a-z0-9][a-z0-9-]*/g, ' ').trim() || body;
      if (
        await createCard(title, {
          channelId: channel.id,
          ...(handle ? { agentHandle: handle } : own ? { agentHandle: own.handle } : {}),
        })
      ) {
        setText('');
        flash(t('board.added'));
      }
      return;
    }
    const meclis = /^\/meclis(?:\s+([\s\S]*))?$/.exec(value);
    if (meclis && channel.kind === 'channel') {
      if (await council(channel.id, meclis[1]?.trim() ?? '')) setText('');
      return;
    }
    if (value === '/yeni-oturum' && own) {
      await newSession(own.id, channel.id);
      setText('');
      return;
    }
    if (await send(value)) setText('');
  };

  const placeholder = own
    ? t('channel.composerAgent', { handle: own.handle })
    : t('shell.composer', { channel: channel.name });
  return (
    <div className="composer">
      <AnimatePresence>
        {options.length > 0 && (
          <motion.ul
            className="mentions"
            aria-label={mention ? t('channel.agents') : t('shortcuts.command')}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
          >
            {options.map((o, i) => (
              <li key={o.key} data-selected={i === pick % options.length || undefined}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(o)}>
                  {o.icon === 'terminal' ? (
                    <Avatar name="" icon="terminal" size={22} />
                  ) : (
                    <Icon name={o.icon} size={14} />
                  )}
                  <b>{o.label}</b>
                  <span>{o.detail}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {note && (
          <motion.p
            className="composer__note"
            role="status"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <Icon name="check" size={13} />
            {note}
          </motion.p>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {picking && (
          <motion.div
            className="picker"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
          >
            <input
              className="l-input"
              // biome-ignore lint/a11y/noAutofocus: the picker opens on request to be searched
              autoFocus
              value={pickQuery}
              placeholder={t('records.search')}
              aria-label={t('records.search')}
              onChange={(e) => setPickQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setPicking(false)}
            />
            <ul>
              {pickable.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      attach(r.id);
                      setPicking(false);
                      setPickQuery('');
                      ref.current?.focus();
                    }}
                  >
                    <RefChip id={r.id} />
                    <span className="picker__kind">
                      {t(`shell.${r.kind === 'idea' ? 'ideas' : r.kind === 'reference' ? 'references' : 'commands'}`)}
                    </span>
                  </button>
                </li>
              ))}
              {pickable.length === 0 && <li className="muted picker__none">{t('palette.none')}</li>}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
      {tiles.length > 0 && (
        <div className="composer__tiles">
          {tiles.map((c) => (
            <button
              key={c.id}
              type="button"
              className="tile"
              title={c.body}
              onClick={() => {
                const filled = fillCommand(c.body || c.title, {
                  user: me?.name ?? '',
                  channel: channel.name,
                  date: new Date().toLocaleDateString(),
                });
                setText((prev) => (prev.trim() ? `${prev}\n${filled}` : filled));
                requestAnimationFrame(() => ref.current?.focus());
              }}
            >
              <Icon name="bookmark" size={12} />
              {c.title}
            </button>
          ))}
        </div>
      )}
      {attached.length > 0 && (
        <div className="composer__refs">
          {attached.map((id) => (
            <RefChip key={id} id={id} onRemove={() => detach(id)} />
          ))}
        </div>
      )}
      <div className="composer__box">
        <IconButton icon="plus" label={t('records.pick')} onClick={() => setPicking((v) => !v)} />
        <label className="l-sr" htmlFor="composer">
          {placeholder}
        </label>
        <textarea
          id="composer"
          ref={ref}
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setPick(0);
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.some((f) => f.type.startsWith('image/'))) {
              e.preventDefault();
              void pasteImages(files);
            }
          }}
          onKeyDown={(e) => {
            if (options.length > 0) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
                return;
              }
              if (e.key === 'Tab' || (e.key === 'Enter' && !exact)) {
                e.preventDefault();
                const chosen = options[pick % options.length];
                if (chosen) insert(chosen);
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <Kbd>Enter</Kbd>
        <button
          type="button"
          className="composer__send"
          aria-label={t('shell.send')}
          disabled={!text.trim()}
          onClick={() => void submit()}
        >
          <Icon name="send" size={16} />
        </button>
      </div>
    </div>
  );
}

export function ChannelView({ channel }: { channel: Channel }) {
  const { t, i18n } = useTranslation();
  const agents = useApp((s) => s.workspace?.agents ?? []);
  const messages = useApp((s) => s.messages[channel.id] ?? EMPTY);
  const jobs = useApp((s) => s.jobs);
  const newSession = useApp((s) => s.newSession);
  const openAgentDialog = useApp((s) => s.openAgentDialog);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const own = channel.kind === 'agent' ? agents.find((a) => a.id === channel.agentId) : undefined;

  const jobsByRequest = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const j of Object.values(jobs)) {
      if (j.channelId !== channel.id) continue;
      map.set(
        j.requestId,
        [...(map.get(j.requestId) ?? []), j].sort((a, b) => a.started - b.started),
      );
    }
    return map;
  }, [jobs, channel.id]);

  // Keep the newest message in view while the reader is at the bottom.
  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  return (
    <main className="chat">
      <header className="chat__head">
        <h2>
          <Icon name={own ? 'terminal' : 'hash'} size={15} />
          {own ? own.name : channel.name}
        </h2>
        {own ? (
          <>
            <Chip mono>@{own.handle}</Chip>
            <Chip mono>{t(`agentForm.modes.${own.mode}`)}</Chip>
            <span className="chat__topic l-mono">{own.folder}</span>
          </>
        ) : (
          <span className="chat__topic">{t('channel.channelHint')}</span>
        )}
        <span className="grow" />
        {own && (
          <>
            <Button
              size="sm"
              variant="quiet"
              icon="refresh"
              title={t('channel.newSessionHint')}
              onClick={() => void newSession(own.id, channel.id)}
            >
              {t('channel.newSession')}
            </Button>
            <IconButton icon="settings" label={t('agentForm.edit')} onClick={() => openAgentDialog(own)} />
          </>
        )}
      </header>
      <div
        className="feed"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {messages.length === 0 ? (
          <div className="empty">
            <span className="empty__icon">
              <Icon name={own ? 'terminal' : 'hash'} size={22} />
            </span>
            <p className="empty__title">{t('shell.empty.channel')}</p>
            <p className="empty__sub">
              {own ? t('channel.agentChannelHint', { handle: own.handle }) : t('channel.channelHint')}
            </p>
          </div>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || dayKey(prev.created) !== dayKey(m.created);
            return (
              <Fragment key={m.id}>
                {newDay && (
                  <div className="day">
                    {dayLabel(m.created, i18n.language, t('channel.today'), t('channel.yesterday'))}
                  </div>
                )}
                <MessageRow message={m} agents={agents} jobs={jobsByRequest.get(m.id) ?? []} />
              </Fragment>
            );
          })
        )}
        <Typing channelId={channel.id} />
      </div>
      <Composer channel={channel} agents={agents} />
    </main>
  );
}
