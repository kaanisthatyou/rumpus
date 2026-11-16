import { BRAND } from '@lonca/protocol';
import { Button, Icon, Mark } from '@lonca/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { comboLabel } from '../keys';
import { useApp } from '../store';

/** A paired phone has no island (it is a desktop window). */
const onPhone = typeof document !== 'undefined' && document.documentElement.dataset.phone === '1';

/**
 * The island's global key as the system really has it: undefined while another app holds it (the key in Settings
 * would then promise something that does nothing).
 */
function useIslandKey(): string | undefined {
  const shortcuts = useApp((s) => s.settings?.shortcuts);
  const [key, setKey] = useState<string>();
  useEffect(() => {
    void shortcuts;
    if (onPhone) return;
    let alive = true;
    void window.lonca.quick.key().then((k) => alive && setKey(k ?? undefined));
    const off = window.lonca.quick.onKey((k) => setKey(k));
    return () => {
      alive = false;
      off();
    };
  }, [shortcuts]);
  return key;
}

/** The draggable strip above everything; the window buttons are drawn by the OS on the right. */
export function TitleBar() {
  const { t } = useTranslation();
  const update = useApp((s) => s.update);
  // The island's key is global, so it is named where it is always in sight.
  const key = useIslandKey();
  const keys = key ? comboLabel(key) : '';
  return (
    <header className="titlebar">
      <Mark size={16} />
      <span className="titlebar__name">{BRAND.name}</span>
      <span className="grow" />
      {update.status === 'downloading' && (
        <span className="titlebar__note l-mono">{t('update.downloading', { percent: update.percent ?? 0 })}</span>
      )}
      {update.status === 'ready' && (
        <Button size="sm" variant="primary" icon="download" onClick={() => void window.lonca.updates.install()}>
          {t('update.ready', { version: update.version })} · {t('update.restart')}
        </Button>
      )}
      {!onPhone && (
        <button
          type="button"
          className="titlebar__island"
          title={key ? t('quick.tip', { keys }) : t('quick.noKey')}
          onClick={() => void window.lonca.quick.open()}
        >
          <Icon name="chat" size={13} />
          {key ? t('quick.button', { keys }) : t('quick.title')}
        </button>
      )}
    </header>
  );
}
