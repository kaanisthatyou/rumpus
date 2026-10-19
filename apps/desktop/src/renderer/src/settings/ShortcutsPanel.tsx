// Settings → Shortcuts: every action's key combination, recorded by pressing it, with conflicts refused.
import { SHORTCUTS, type ShortcutAction } from '@lonca/protocol';
import { Button, Kbd } from '@lonca/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bindings, comboLabel, comboOf } from '../keys';
import { useApp } from '../store';

/** The label of each action in the locales (`shortcuts.<key>`). */
export const ACTION_LABEL: Record<ShortcutAction, string> = {
  palette: 'palette',
  settings: 'settings',
  shortcuts: 'list',
  prevChannel: 'prevChannel',
  nextChannel: 'nextChannel',
  stop: 'stop',
  prevWaiting: 'prevWaiting',
  nextWaiting: 'nextWaiting',
  quickEntry: 'quickEntry',
};

export function ShortcutsPanel() {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patch);
  const [recording, setRecording] = useState<ShortcutAction>();
  const [problem, setProblem] = useState<string>();
  const map = bindings(settings);

  useEffect(() => {
    useApp.setState({ recording: recording !== undefined });
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecording(undefined);
        setProblem(undefined);
        return;
      }
      const combo = comboOf(e);
      if (!combo) return;
      if (!e.ctrlKey && !e.altKey) {
        setProblem(t('shortcuts.needsModifier'));
        return;
      }
      const taken = (Object.keys(map) as ShortcutAction[]).find((a) => a !== recording && map[a] === combo);
      if (taken) {
        setProblem(t('shortcuts.taken', { action: t(`shortcuts.${ACTION_LABEL[taken]}`) }));
        return;
      }
      const next = { ...(settings?.shortcuts ?? {}), [recording]: combo };
      if (combo === SHORTCUTS[recording]) delete next[recording];
      const action = recording;
      setRecording(undefined);
      setProblem(undefined);
      // The global one is tried first: when another app holds the keys, the old ones stay.
      if (action === 'quickEntry') {
        void window.lonca.quick.setKey(combo).then((ok) => {
          if (ok) void patch({ shortcuts: next });
          else setProblem(t('shortcuts.globalTaken'));
        });
        return;
      }
      void patch({ shortcuts: next });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, map, settings, patch, t]);

  useEffect(() => () => useApp.setState({ recording: false }), []);

  return (
    <div className="stack">
      <dl className="shortcuts__list shortcuts__list--edit">
        {(Object.keys(SHORTCUTS) as ShortcutAction[]).map((action) => (
          <div key={action} className="shortcuts__row">
            <dt>
              {recording === action ? (
                <span className="shortcuts__rec">{t('shortcuts.press')}</span>
              ) : (
                <Kbd>{comboLabel(map[action])}</Kbd>
              )}
            </dt>
            <dd>{t(`shortcuts.${ACTION_LABEL[action]}`)}</dd>
            <span className="grow" />
            {settings?.shortcuts?.[action] && recording !== action && (
              <Button
                size="sm"
                variant="quiet"
                onClick={() => {
                  const next = { ...(settings.shortcuts ?? {}) };
                  delete next[action];
                  void patch({ shortcuts: next });
                }}
              >
                {t('shortcuts.reset')}
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => setRecording(action)}
              disabled={recording !== undefined && recording !== action}
            >
              {t('shortcuts.change')}
            </Button>
          </div>
        ))}
      </dl>
      {problem && <p className="shortcuts__problem">{problem}</p>}
      <p className="muted">{t('shortcuts.fixed')}</p>
    </div>
  );
}
