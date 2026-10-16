import { Button, Mark } from '@lonca/ui';
import { useTranslation } from 'react-i18next';
import { useApp } from '../store';

/** The draggable strip above everything; the window buttons are drawn by the OS on the right. */
export function TitleBar() {
  const { t } = useTranslation();
  const update = useApp((s) => s.update);
  return (
    <header className="titlebar">
      <Mark size={16} />
      <span className="titlebar__name">Lonca</span>
      <span className="grow" />
      {update.status === 'downloading' && (
        <span className="titlebar__note l-mono">{t('update.downloading', { percent: update.percent ?? 0 })}</span>
      )}
      {update.status === 'ready' && (
        <Button size="sm" variant="primary" icon="download" onClick={() => void window.lonca.updates.install()}>
          {t('update.ready', { version: update.version })} · {t('update.restart')}
        </Button>
      )}
    </header>
  );
}
