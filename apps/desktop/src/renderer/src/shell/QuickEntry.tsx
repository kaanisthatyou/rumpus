// Quick entry (PLAN.md 5.10): a small always-on-top window, opened from anywhere with Ctrl Alt Space, to write to a
// channel or straight to an agent without bringing Serai forward. It hides when it loses focus or after sending.
import type { Channel, Settings, WorkspaceState } from '@lonca/protocol';
import { Icon, Mark } from '@lonca/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { core } from '../rpc';

const LAST = 'lonca.quick.channel';

function remembered(): string | undefined {
  try {
    return localStorage.getItem(LAST) ?? undefined;
  } catch {
    return undefined;
  }
}

function remember(id: string): void {
  try {
    localStorage.setItem(LAST, id);
  } catch {
    // nothing to remember then
  }
}

export function QuickEntry() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useState<WorkspaceState>();
  const [channelId, setChannelId] = useState<string>('');
  const [text, setText] = useState('');
  const [note, setNote] = useState<string>();
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const load = async () => {
      const settings: Settings = await core.call('settings.get');
      await i18n.changeLanguage(settings.language);
      const root = document.documentElement;
      const light =
        settings.theme === 'light' ||
        (settings.theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
      root.dataset.theme = light ? 'light' : 'dark';
      root.dataset.accent = settings.accent;
      root.lang = settings.language;
      const ws = await core.call('workspace.get');
      setWorkspace(ws);
      const last = remembered();
      setChannelId((ws.channels.find((c) => c.id === last) ?? ws.channels[0])?.id ?? '');
    };
    void load();
    core.onConnect(() => void load());
    // Every time the window is shown again it gets focus: the text box is ready.
    const focus = () => {
      setNote(undefined);
      input.current?.focus();
    };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, []);

  const label = (c: Channel) => {
    const agent = c.kind === 'agent' ? workspace?.agents.find((a) => a.id === c.agentId) : undefined;
    return agent ? `@${agent.handle}` : `#${c.name}`;
  };

  const send = async () => {
    const value = text.trim();
    if (!value || !channelId) return;
    try {
      await core.call('messages.send', { channelId, text: value });
      remember(channelId);
      setText('');
      setNote(t('quick.sent'));
      setTimeout(() => void window.lonca.quick.hide(), 500);
    } catch (err) {
      setNote(t(`errors.${(err as { code?: string }).code ?? 'internal'}`, t('errors.internal')));
    }
  };

  return (
    <main className="quick">
      <div className="quick__row">
        <Mark size={22} />
        <select
          className="l-input quick__to"
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
        <span className="grow quick__ws muted">{workspace?.kind === 'team' ? workspace.name : ''}</span>
        <span className="quick__keys muted l-mono">Enter · Esc</span>
      </div>
      <textarea
        ref={input}
        className="l-input quick__text"
        // biome-ignore lint/a11y/noAutofocus: the window exists to type into
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
      {note && (
        <p className="quick__note" role="status">
          <Icon name="check" size={13} />
          {note}
        </p>
      )}
    </main>
  );
}
