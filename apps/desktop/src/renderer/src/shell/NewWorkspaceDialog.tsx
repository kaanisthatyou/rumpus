// A new team workspace (a "lonca"): its own channels, agents, board and records.
import { Button, IconButton, TextField } from '@lonca/ui';
import { motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorLine } from '../parts';
import { useApp } from '../store';

export function NewWorkspaceDialog() {
  const { t } = useTranslation();
  const createWorkspace = useApp((s) => s.createWorkspace);
  const joinWithCode = useApp((s) => s.joinWithCode);
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  const close = useCallback(() => useApp.setState({ newWorkspaceOpen: false }), []);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  return (
    <motion.div
      className="l-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <motion.form
        className="l-dialog agentform wsform"
        role="dialog"
        aria-modal="true"
        aria-label={t('shell.newWorkspace')}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 460, damping: 34 } }}
        exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const ok = joining ? await joinWithCode(code.trim()) : await createWorkspace(name);
          setBusy(false);
          if (ok) close();
        }}
      >
        <header className="agentform__head">
          <h2>{joining ? t('workspaces.join') : t('shell.newWorkspace')}</h2>
          <IconButton icon="close" label={t('common.close')} onClick={close} />
        </header>
        <div className="agentform__body">
          {joining ? (
            <>
              <p className="muted">{t('workspaces.joinIntro')}</p>
              <div className="l-field">
                <label className="l-field__label" htmlFor="join-code">
                  {t('workspaces.code')}
                </label>
                <textarea
                  id="join-code"
                  className="l-input l-mono agentform__text"
                  value={code}
                  rows={3}
                  spellCheck={false}
                  onChange={(e) => setCode(e.target.value)}
                />
                <span className="l-field__hint">{t('workspaces.codeHint')}</span>
              </div>
            </>
          ) : (
            <>
              <p className="muted">{t('workspaces.intro')}</p>
              <TextField
                label={t('workspaces.name')}
                value={name}
                maxLength={40}
                required
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
            </>
          )}
          <ErrorLine />
        </div>
        <footer className="agentform__foot">
          <Button variant="quiet" onClick={() => setJoining((j) => !j)}>
            {joining ? t('workspaces.makeInstead') : t('workspaces.join')}
          </Button>
          <span className="grow" />
          <Button variant="quiet" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={joining ? !code.trim() : !name.trim()}>
            {joining ? t('workspaces.askToJoin') : t('workspaces.create')}
          </Button>
        </footer>
      </motion.form>
    </motion.div>
  );
}
