import type { Agent, Channel, Job, Message } from '@lonca/protocol';
import { Avatar, Button, Chip, Icon, IconButton, Kbd } from '@lonca/ui';
import { AnimatePresence, motion } from 'motion/react';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../store';
import { clock, dayKey, dayLabel } from './format';
import { JobCard } from './JobCard';
import { Markdown } from './Markdown';

const EMPTY: Message[] = [];

function MessageRow({ message, agents, jobs }: { message: Message; agents: Agent[]; jobs: Job[] }) {
  const { t } = useTranslation();
  const me = useApp((s) => s.workspace?.me.id);
  const editMessage = useApp((s) => s.editMessage);
  const deleteMessage = useApp((s) => s.deleteMessage);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.text);
  const a = message.author;
  const own = a.kind === 'person' && a.id === me;
  const name = a.kind === 'system' ? 'Lonca' : a.name;
  const agent = a.kind === 'agent' ? agents.find((x) => x.id === a.id) : undefined;

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
          <time className="l-mono">{clock(message.created)}</time>
          {message.edited && <span className="msg__edited">{t('channel.edited')}</span>}
          {own && !editing && (
            <span className="msg__actions">
              <IconButton size="sm" icon="pencil" label={t('channel.edit')} onClick={() => setEditing(true)} />
              <IconButton
                size="sm"
                icon="trash"
                label={t('channel.delete')}
                onClick={() => void deleteMessage(message.id)}
              />
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
          <Markdown text={message.text} />
        )}
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} agent={agents.find((x) => x.id === job.agentId)} />
        ))}
      </div>
    </motion.article>
  );
}

function Composer({ channel, agents }: { channel: Channel; agents: Agent[] }) {
  const { t } = useTranslation();
  const send = useApp((s) => s.send);
  const [text, setText] = useState('');
  const [pick, setPick] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const own = channel.kind === 'agent' ? agents.find((a) => a.id === channel.agentId) : undefined;

  // `@` at the caret opens the agent list.
  const caret = ref.current?.selectionStart ?? text.length;
  const mention = /(^|\s)@([a-z0-9-]*)$/.exec(text.slice(0, caret));
  const options = mention ? agents.filter((a) => a.handle.startsWith(mention[2] ?? '')).slice(0, 6) : [];

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  });

  const insert = (handle: string) => {
    if (!mention) return;
    const start = caret - (mention[2]?.length ?? 0) - 1;
    const next = `${text.slice(0, start)}@${handle} ${text.slice(caret)}`;
    setText(next);
    setPick(0);
    requestAnimationFrame(() => {
      const pos = start + handle.length + 2;
      ref.current?.setSelectionRange(pos, pos);
      ref.current?.focus();
    });
  };

  const submit = async () => {
    if (!text.trim()) return;
    if (await send(text)) setText('');
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
            aria-label={t('channel.agents')}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
          >
            {options.map((a, i) => (
              <li key={a.id} data-selected={i === pick % options.length || undefined}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(a.handle)}>
                  <Avatar name="" icon="terminal" size={22} />
                  <b>@{a.handle}</b>
                  <span>{a.name}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
      <div className="composer__box">
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
          onKeyDown={(e) => {
            if (options.length > 0) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                const chosen = options[pick % options.length];
                if (chosen) insert(chosen.handle);
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
      </div>
      <Composer channel={channel} agents={agents} />
    </main>
  );
}
