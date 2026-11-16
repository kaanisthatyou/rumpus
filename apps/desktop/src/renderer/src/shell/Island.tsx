// The island (PLAN.md 5.10): quick entry as a see-through layer over the whole screen, opened from anywhere with
// Ctrl Alt Space. A floating text box writes to a channel or an agent of any workspace (choosing another workspace
// opens it in the app too, as the rail does). Above it runs a short conversation: this person's messages on the
// right, and on the left one card per job of their agents that stays where it began, shows the line being written
// while it works and becomes the answer when it ends. Tool calls, commands and code never appear on it. The feed
// scrolls and keeps to its newest line unless it was scrolled up. Clicks pass through to the desktop except over
// the text box and the feed.
import type { Channel, Job, Message, Settings, WorkspaceState, WorkspaceSummary } from '@lonca/protocol';
import { Icon, IconButton, Mark } from '@lonca/ui';
import { type FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { concernsMe } from '../agents/owner';
import i18n from '../i18n';
import { core } from '../rpc';
import { type AgentTurn, addAnswer, addMine, setLines, type Turn, updateJob, view } from './island-feed';
import { plain } from './island-text';

const LAST = 'lonca.quick.channel';
/** How close to the bottom the feed counts as following the newest line, in pixels. */
const STICK = 32;

/** The channel last written to from the island, one per workspace. */
function remembered(ws: string): string | undefined {
  try {
    return localStorage.getItem(ws === 'personal' ? LAST : `${LAST}.${ws}`) ?? undefined;
  } catch {
    return undefined;
  }
}

function remember(ws: string, id: string): void {
  try {
    localStorage.setItem(ws === 'personal' ? LAST : `${LAST}.${ws}`, id);
  } catch {
    // nothing to remember then
  }
}

/** The channel to show for a workspace: the one already chosen if it is there, else the remembered one, else the first. */
function pick(w: WorkspaceState, current: string): string {
  if (w.channels.some((x) => x.id === current)) return current;
  const last = remembered(w.id);
  return (w.channels.find((x) => x.id === last) ?? w.channels[0])?.id ?? '';
}

function labelOf(w: WorkspaceState | undefined, c: Channel | undefined): string {
  if (!c) return '';
  const agent = c.kind === 'agent' ? w?.agents.find((a) => a.id === c.agentId) : undefined;
  return agent ? `@${agent.handle}` : `#${c.name}`;
}

/** Who wrote and where, kept with the turn: it still reads right after another workspace is chosen. */
function originOf(w: WorkspaceState | undefined, agentId: string, channelId: string): { who: string; where: string } {
  const c = w?.channels.find((x) => x.id === channelId);
  return {
    who: w?.agents.find((a) => a.id === agentId)?.name ?? '',
    // The agent's own channel needs no name beside the agent's.
    where: c && c.kind !== 'agent' ? `#${c.name}` : '',
  };
}

function applyLook(settings: Settings): void {
  const root = document.documentElement;
  const light =
    settings.theme === 'light' || (settings.theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
  root.dataset.theme = light ? 'light' : 'dark';
  root.dataset.accent = settings.accent;
  root.dataset.motion = settings.motion;
  root.lang = settings.language;
}

/** Where this person's message before the i-th turn went. */
function lastWhere(turns: Turn[], i: number): string | undefined {
  for (let j = i - 1; j >= 0; j--) {
    const x = turns[j];
    if (x?.kind === 'me') return x.where;
  }
  return undefined;
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** `sameWhere`: the card is in the channel the conversation is already in, so it does not name it again. */
function AgentCard({ turn, now, sameWhere }: { turn: AgentTurn; now: number; sameWhere: boolean }) {
  const { t } = useTranslation();
  const { main, notes } = view(turn);
  const working = turn.state === 'running';
  const waiting = turn.state === 'attention';
  const answered = turn.answer !== undefined;
  const ended = turn.state === 'failed' || turn.state === 'stopped';
  return (
    <li className={`isle-turn isle-turn--agent${answered ? ' is-answer' : ''}`}>
      <div className="isle-card">
        <div className="isle-card__head">
          <b>{turn.who}</b>
          {turn.where && !sameWhere && <span className="isle-card__where">{turn.where}</span>}
          <span className="grow" />
          {working && (
            <span className="isle-card__state">
              <span className="isle-ring" aria-hidden="true" />
              <span className="l-mono">{clock(now - (turn.started ?? now))}</span>
            </span>
          )}
          {(waiting || ended) && (
            <span className={`isle-card__state${waiting ? ' is-wait' : ''}`}>{t(`job.state.${turn.state}`)}</span>
          )}
        </div>
        {notes.length > 0 && (
          <details className="isle-notes">
            <summary>{t('quick.notes', { count: notes.length })}</summary>
            <ol>
              {notes.map((line, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: notes only grow at the end; equal lines are possible
                <li key={i}>{line}</li>
              ))}
            </ol>
          </details>
        )}
        {main !== undefined && (
          <p className={`isle-card__text${answered ? '' : ' is-live'}${working && !answered ? ' has-caret' : ''}`}>
            {main}
          </p>
        )}
        {waiting && (
          <button type="button" className="isle-card__open" onClick={() => void window.lonca.quick.openApp()}>
            <Icon name="home" size={13} />
            {t('quick.openApp')}
          </button>
        )}
      </div>
    </li>
  );
}

export function Island() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useState<WorkspaceState>();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [channelId, setChannelId] = useState<string>('');
  const [text, setText] = useState('');
  const [note, setNote] = useState<string>();
  const [focused, setFocused] = useState(true);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [now, setNow] = useState(() => Date.now());
  /** Newer lines arrived while the feed was scrolled up. */
  const [unseen, setUnseen] = useState(false);
  /** The feed is scrolled away from its top: the top edge fades. */
  const [clipped, setClipped] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const feed = useRef<HTMLOListElement>(null);
  const stuck = useRef(true);
  const ws = useRef<WorkspaceState | undefined>(undefined);
  const jobs = useRef(new Map<string, Job>());
  const fetching = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  /** The text an agent wrote while working, read from its job's transcript (tool calls stay out). */
  const readWork = useCallback((jobId: string) => {
    clearTimeout(fetching.current.get(jobId));
    fetching.current.set(
      jobId,
      setTimeout(() => {
        fetching.current.delete(jobId);
        void core
          .call('jobs.transcript', { id: jobId })
          .then((entries) => {
            const lines = entries.flatMap((e) => (e.t === 'text' ? [plain(e.text)] : []));
            setTurns((list) => setLines(list, jobId, lines));
          })
          .catch(() => {
            // Another member's computer runs it: its answer still arrives as a message.
          });
      }, 250),
    );
  }, []);

  const onJob = useCallback(
    (job: Job) => {
      if (!concernsMe(job, ws.current)) return;
      jobs.current.set(job.id, job);
      const { who, where } = originOf(ws.current, job.agentId, job.channelId);
      const live = job.preview ? plain(job.preview) : '';
      setTurns((list) =>
        updateJob(
          list,
          { id: job.id, state: job.state, started: job.started, requestId: job.requestId, ...(live ? { live } : {}) },
          who,
          where,
        ),
      );
      readWork(job.id);
    },
    [readWork],
  );

  useEffect(() => {
    const load = async () => {
      const settings: Settings = await core.call('settings.get');
      await i18n.changeLanguage(settings.language);
      applyLook(settings);
      const w = await core.call('workspace.get');
      ws.current = w;
      setWorkspace(w);
      setChannelId((c) => pick(w, c));
      // Jobs already running when the island starts get their cards too.
      for (const job of w.active) onJob(job);
      setWorkspaces(await core.call('workspaces.list'));
    };
    void load();
    const offs = [
      core.onConnect(() => void load()),
      core.on('settings.changed', (s) => {
        applyLook(s);
        void i18n.changeLanguage(s.language);
      }),
      core.on('workspace.changed', (w) => {
        ws.current = w;
        setWorkspace(w);
        setChannelId((c) => pick(w, c));
      }),
      core.on('workspaces.changed', (list) => setWorkspaces(list)),
      core.on('job.updated', onJob),
      core.on('message.added', (m: Message) => {
        if (m.author.kind !== 'agent') return;
        const agentId = m.author.id;
        const job = m.jobId ? jobs.current.get(m.jobId) : undefined;
        const agent = ws.current?.agents.find((a) => a.id === agentId);
        const mine = job ? concernsMe(job, ws.current) : !agent?.owner || agent.owner === ws.current?.me.id;
        if (!mine) return;
        const { who, where } = originOf(ws.current, agentId, m.channelId);
        setTurns((list) =>
          addAnswer(list, {
            id: m.id,
            ...(m.jobId ? { jobId: m.jobId } : {}),
            at: m.created,
            who,
            where,
            text: plain(m.text),
          }),
        );
      }),
    ];
    // Every time the island is brought up it gets focus: the text box is ready and the feed shows its newest line.
    const onFocus = () => {
      setFocused(true);
      setNote(undefined);
      input.current?.focus();
      const el = feed.current;
      if (el) el.scrollTop = el.scrollHeight;
      stuck.current = true;
      setUnseen(false);
    };
    const onBlur = () => setFocused(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    // The island takes the mouse only over its own things; the rest of the screen stays the desktop's.
    let solid = false;
    const point = (e: MouseEvent) => {
      const next = Boolean((e.target as Element | null)?.closest?.('[data-solid]'));
      if (next === solid) return;
      solid = next;
      void window.lonca.quick.solid(next);
    };
    const leave = () => {
      if (!solid) return;
      solid = false;
      void window.lonca.quick.solid(false);
    };
    document.addEventListener('mousemove', point);
    document.addEventListener('mouseleave', leave);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      for (const off of offs) off?.();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('mousemove', point);
      document.removeEventListener('mouseleave', leave);
      clearInterval(tick);
    };
  }, [onJob]);

  // New lines: follow them when the feed is at its bottom, otherwise say that they are there.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs for every change of the turns
  useLayoutEffect(() => {
    const el = feed.current;
    if (!el) return;
    if (stuck.current) el.scrollTop = el.scrollHeight;
    else setUnseen(true);
    setClipped(el.scrollTop > 0);
  }, [turns]);

  const onScroll = () => {
    const el = feed.current;
    if (!el) return;
    stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK;
    if (stuck.current) setUnseen(false);
    setClipped(el.scrollTop > 0);
  };

  const toBottom = () => {
    const el = feed.current;
    if (!el) return;
    stuck.current = true;
    setUnseen(false);
    el.scrollTo({
      top: el.scrollHeight,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };

  const spaceName = (w: WorkspaceSummary) =>
    w.kind === 'personal' ? t('shell.workspace') : (w.friend?.name ?? w.name);
  const choose = async (id: string) => {
    if (id === workspace?.id) return;
    try {
      // The workspace opens in the app as well: the island hears the open one's agents.
      await core.call('workspaces.open', { id });
      input.current?.focus();
    } catch (err) {
      setNote(t(`errors.${(err as { code?: string }).code ?? 'internal'}`, t('errors.internal')));
    }
  };

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const value = text.trim();
    if (!value || !channelId) return;
    try {
      const m = await core.call('messages.send', { channelId, text: value });
      if (workspace) remember(workspace.id, channelId);
      setText('');
      setNote(t('quick.sent'));
      setTimeout(() => setNote(undefined), 1600);
      // Writing is following the conversation again.
      stuck.current = true;
      const where = labelOf(
        workspace,
        workspace?.channels.find((c) => c.id === channelId),
      );
      setTurns((list) => addMine(list, { id: m.id, at: m.created, where, text: value }));
    } catch (err) {
      setNote(t(`errors.${(err as { code?: string }).code ?? 'internal'}`, t('errors.internal')));
    }
  };

  const spaces = workspaces.filter((w) => !w.state);

  return (
    <main className={`island${focused ? '' : ' island--idle'}`}>
      <div className="island__column">
        {turns.length > 0 && (
          <div className="isle-feed" data-solid>
            <ol
              ref={feed}
              className={`island__feed${clipped ? ' is-clipped' : ''}`}
              aria-label={t('quick.feed')}
              aria-live="polite"
              onScroll={onScroll}
            >
              {turns.map((turn, i) =>
                turn.kind === 'me' ? (
                  <li key={turn.key} className="isle-turn isle-turn--me">
                    <div className="isle-mine">
                      {/* Where it went, when that changed since the message before. */}
                      {turn.where !== lastWhere(turns, i) && <span className="isle-mine__where">{turn.where}</span>}
                      <p className="isle-mine__text">{turn.text}</p>
                    </div>
                  </li>
                ) : (
                  <AgentCard key={turn.key} turn={turn} now={now} sameWhere={turn.where === lastWhere(turns, i)} />
                ),
              )}
            </ol>
            {unseen && (
              <button type="button" className="isle-newer" onClick={toBottom}>
                <Icon name="chevronDown" size={13} />
                {t('quick.newer')}
              </button>
            )}
          </div>
        )}
        <form className="island__dock" data-solid onSubmit={send}>
          <Mark size={20} />
          {spaces.length > 1 && (
            <select
              className="island__to island__ws"
              aria-label={t('quick.server')}
              value={workspace?.id ?? ''}
              onChange={(e) => void choose(e.target.value)}
            >
              {spaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {spaceName(w)}
                </option>
              ))}
            </select>
          )}
          <select
            className="island__to"
            aria-label={t('quick.to')}
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
          >
            {workspace?.channels.map((c) => (
              <option key={c.id} value={c.id}>
                {labelOf(workspace, c)}
              </option>
            ))}
          </select>
          <textarea
            ref={input}
            className="island__text-in"
            rows={1}
            // biome-ignore lint/a11y/noAutofocus: the island exists to type into
            autoFocus
            value={text}
            aria-label={t('quick.message')}
            placeholder={t('quick.placeholder')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') void window.lonca.quick.hide();
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <IconButton icon="send" label={t('quick.send')} size="sm" type="submit" disabled={!text.trim()} />
          {turns.length > 0 && (
            <IconButton icon="trash" label={t('quick.clear')} size="sm" onClick={() => setTurns([])} />
          )}
          <IconButton
            icon="home"
            label={t('quick.openApp')}
            size="sm"
            onClick={() => void window.lonca.quick.openApp()}
          />
          <IconButton icon="close" label={t('quick.hide')} size="sm" onClick={() => void window.lonca.quick.hide()} />
        </form>
        <p className="island__hint" role="status">
          {note ? (
            <>
              <Icon name="check" size={12} />
              {note}
            </>
          ) : (
            <span className="l-mono">{t('quick.keys')}</span>
          )}
        </p>
      </div>
    </main>
  );
}
