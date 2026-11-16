// The question before something that cannot be undone: what goes, and one button that does it. Esc, the overlay
// and "Cancel" leave everything as it was.
import { Button, Icon, IconButton } from '@lonca/ui';
import { motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorLine } from '../parts';
import { type Confirm, useApp } from '../store';

export function ConfirmDialog({ ask }: { ask: Confirm }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => useApp.setState({ confirm: undefined }), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, busy]);

  const go = async () => {
    setBusy(true);
    const done = await ask.run();
    setBusy(false);
    if (done) close();
  };

  return (
    <motion.div
      className="l-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}
    >
      <motion.div
        className="l-dialog agentform confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 460, damping: 34 } }}
        exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
      >
        <header className="agentform__head">
          <h2 id="confirm-title">{ask.title}</h2>
          <IconButton icon="close" label={t('common.close')} onClick={close} disabled={busy} />
        </header>
        <div className="agentform__body">
          <p id="confirm-body" className="confirm__body">
            <Icon name="alert" size={16} />
            <span>{ask.body}</span>
          </p>
          <ErrorLine />
        </div>
        <footer className="agentform__foot">
          <span className="grow" />
          <Button variant="quiet" onClick={close} disabled={busy}>
            {t('common.cancel')}
          </Button>
          {/* biome-ignore lint/a11y/noAutofocus: the dialog asks one thing; Enter answers it, Esc leaves */}
          <Button variant="danger" icon="trash" busy={busy} onClick={() => void go()} autoFocus>
            {ask.action}
          </Button>
        </footer>
      </motion.div>
    </motion.div>
  );
}
