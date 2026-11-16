// The island (PLAN.md 5.10): quick entry as a see-through layer over the whole screen, opened from anywhere with
// Ctrl Alt Space. A floating text box writes to a channel or an agent of any workspace (choosing another workspace
// opens it in the app too, as the rail does); above it, what this person's agents say
// arrives as bubbles: their answers and the text they write while they work. Tool calls, commands and code never
// appear on it. Clicks pass through to the desktop except over the text box and the bubbles.
import type { Agent, Channel, Job, Message, Settings, WorkspaceState, WorkspaceSummary } from '@lonca/protocol';
import { Icon, IconButton, Mark } from '@lonca/ui';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { concernsMe } from '../agents/owner';
import i18n from '../i18n';
import { core } from '../rpc';
import { plain } from './island-text';

const LAST = 'lonca.quick.channel';
/** Bubbles kept on the screen; older ones leave as new ones come. */
const KEEP = 12;

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

/** Where a bubble came from: the agent, and the channel when it is not the agent's own. Kept with the bubble, so
 * it still reads right after another workspace is chosen. */
function originOf(w: WorkspaceState | undefined, agentId: string | undefined, channelId: string): string {
  const agent = w?.agents.find((a) => a.id === agentId);
  const c = w?.channels.find((x) => x.id === channelId);
  const where = c && c.kind !== 'agent' ? ` · #${c.name}` : '';
  return `${agent?.name ?? ''}${where}`;
}

type BubbleKind = 'work' | 'live' | 'answer' | 'me';

interface Bubble {
  key: string;
  kind: BubbleKind;
  jobId?: string;
  agentId?: string;
  channelId: string;
  /** Who and where, for the bubbles of agents. */
  from?: string;
  text: string;
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

export function Island() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useState<WorkspaceState>();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [channelId, setChannelId] = useState<string>('');
  const [text, setText] = useState('');
  const [note, setNote] = useState<string>();
  const [focused, setFocused] = useState(true);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [running, setRunning] = useState<Job[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLTextAreaElement>(null);
  const ws = useRef<WorkspaceState | undefined>(undefined);
  const jobs = useRef(new Map<string, Job>());
  /** How many of a job's text lines are already on the screen. */
  const shown = useRef(new Map<string, number>());
  const fetching = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const add = useCallback((b: Bubble | Bubble[]) => {
    setBubbles((list) => {
      const more = (Array.isArray(b) ? b : [b]).filter((x) => x.text && !list.some((y) => y.key === x.key));
      return more.length ? [...list, ...more].slice(-KEEP) : list;
    });
  }, []);

  /** The text an agent wrote while working, read from its job's transcript (tool calls stay out). */
  const readWork = useCallback(
    (jobId: string) => {
      clearTimeout(fetching.current.get(jobId));
      fetching.current.set(
        jobId,
        setTimeout(() => {
          fetching.current.delete(jobId);
          void core
            .call('jobs.transcript', { id: jobId })
            .then((entries) => {
              const job = jobs.current.get(jobId);
              if (!job || job.state !== 'running') return;
              const texts = entries.flatMap((e) => (e.t === 'text' ? [plain(e.text)] : []));
              const from = shown.current.get(jobId) ?? 0;
              if (texts.length <= from) return;
              shown.current.set(jobId, texts.length);
              add(
                texts.slice(from).map((text, i) => ({
                  key: `w:${jobId}:${from + i}`,
                  kind: 'work' as const,
                  jobId,
                  agentId: job.agentId,
                  channelId: job.channelId,
                  from: originOf(ws.current, job.agentId, job.channelId),
                  text,
                })),
              );
            })
            .catch(() => {
              // Another member's computer runs it: its answer still arrives as a message.
            });
        }, 250),
      );
    },
    [add],
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
      core.on('job.updated', (job) => {
        if (!concernsMe(job, ws.current)) return;
        jobs.current.set(job.id, job);
        const live = job.state === 'running' || job.state === 'attention';
        setRunning((list) => {
          const rest = list.filter((j) => j.id !== job.id);
          return live ? [...rest, job] : rest;
        });
        if (job.state !== 'running') {
          setBubbles((list) => list.filter((b) => b.key !== `l:${job.id}`));
          return;
        }
        const preview = job.preview ? plain(job.preview) : '';
        setBubbles((list) => {
          const rest = list.filter((b) => b.key !== `l:${job.id}`);
          if (!preview) return rest;
          const bubble: Bubble = {
            key: `l:${job.id}`,
            kind: 'live',
            jobId: job.id,
            agentId: job.agentId,
            channelId: job.channelId,
            from: originOf(ws.current, job.agentId, job.channelId),
            text: preview,
          };
          return [...rest, bubble].slice(-KEEP);
        });
        readWork(job.id);
      }),
      core.on('message.added', (m: Message) => {
        if (m.author.kind !== 'agent') return;
        const agentId = m.author.id;
        const job = m.jobId ? jobs.current.get(m.jobId) : undefined;
        const agent = ws.current?.agents.find((a) => a.id === agentId);
        const mine = job ? concernsMe(job, ws.current) : !agent?.owner || agent.owner === ws.current?.me.id;
        if (!mine) return;
        const text = plain(m.text);
        setBubbles((list) => {
          const rest = list.filter((b) => b.key !== `l:${m.jobId}`);
          // The answer is usually the last thing the agent wrote while working: that bubble becomes the answer.
          const same = rest.findLastIndex((b) => b.jobId === m.jobId && b.kind === 'work' && b.text === text);
          if (same >= 0) return rest.map((b, i) => (i === same ? { ...b, kind: 'answer' } : b));
          if (!text || rest.some((b) => b.key === `a:${m.id}`)) return rest;
          const bubble: Bubble = {
            key: `a:${m.id}`,
            kind: 'answer',
            ...(m.jobId ? { jobId: m.jobId } : {}),
            agentId,
            channelId: m.channelId,
            from: originOf(ws.current, agentId, m.channelId),
            text,
          };
          return [...rest, bubble].slice(-KEEP);
        });
      }),
    ];
    // Every time the island is brought up it gets focus: the text box is ready.
    const onFocus = () => {
      setFocused(true);
      setNote(undefined);
      input.current?.focus();
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
  }, [readWork]);

  const agentOf = (id?: string): Agent | undefined => workspace?.agents.find((a) => a.id === id);
  const label = (c: Channel) => {
    const agent = c.kind === 'agent' ? agentOf(c.agentId) : undefined;
    return agent ? `@${agent.handle}` : `#${c.name}`;
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
      add({ key: `m:${m.id}`, kind: 'me', channelId, text: value });
    } catch (err) {
      setNote(t(`errors.${(err as { code?: string }).code ?? 'internal'}`, t('errors.internal')));
    }
  };

  const seconds = (job: Job) => Math.max(0, Math.floor((now - job.started) / 1000));
  const since = (job: Job) => {
    const s = seconds(job);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <main className={`island${focused ? '' : ' island--idle'}`}>
      <div className="island__column">
        <ol className="island__feed" aria-label={t('quick.feed')} aria-live="polite">
          {bubbles.map((b, i) => (
            <li
              key={b.key}
              data-solid
              className={`island__bubble island__bubble--${b.kind}`}
              style={{ '--age': bubbles.length - 1 - i } as React.CSSProperties}
            >
              {b.kind !== 'me' && (
                <span className="island__from">
                  {b.from}
                  {b.kind === 'work' || b.kind === 'live' ? ` · ${t('job.state.running')}` : ''}
                </span>
              )}
              <span className="island__text">{b.text}</span>
            </li>
          ))}
        </ol>
        {running.length > 0 && (
          <ul className="island__jobs">
            {running.map((job) => (
              <li key={job.id}>
                <button
                  type="button"
                  data-solid
                  className={`island__job${job.state === 'attention' ? ' island__job--wait' : ''}`}
                  onClick={() => void window.lonca.quick.openApp()}
                  title={t('quick.openApp')}
                >
                  <span className="island__ring" aria-hidden="true" />
                  <span>@{agentOf(job.agentId)?.handle ?? ''}</span>
                  <span className="island__meta">
                    {t(`job.state.${job.state}`)} · <span className="l-mono">{since(job)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="island__dock" data-solid onSubmit={send}>
          <Mark size={20} />
          {workspaces.filter((w) => !w.state).length > 1 && (
            <select
              className="island__to island__ws"
              aria-label={t('quick.server')}
              value={workspace?.id ?? ''}
              onChange={(e) => void choose(e.target.value)}
            >
              {workspaces
                .filter((w) => !w.state)
                .map((w) => (
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
                {label(c)}
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
          {bubbles.length > 0 && (
            <IconButton icon="trash" label={t('quick.clear')} size="sm" onClick={() => setBubbles([])} />
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
