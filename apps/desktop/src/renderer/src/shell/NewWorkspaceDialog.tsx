// A new team workspace, or joining one with an invite. Before a join request goes out, the invite is read and
// the way to the inviter's computer is tried, so what is missing (Tailscale, the device in sight, the app) is
// named instead of the request simply failing.
import { INVITE_PREFIX, type InviteCheck } from '@lonca/protocol';
import { Button, Icon, IconButton, Spinner, TextField } from '@lonca/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorLine, TailscaleRow } from '../parts';
import { core } from '../rpc';
import { useApp } from '../store';

const SHARING = 'https://tailscale.com/kb/1084/sharing';
/** Tailscale's address ranges: an invite to another address (a test on one computer) has no device to look for. */
const TAILSCALE_IP = /^(100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|\[?fd7a:115c:a1e0:)/i;

type Check = { state: 'idle' } | { state: 'checking' } | { state: 'bad' } | { state: 'done'; result: InviteCheck };

function CheckRow({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <motion.li
      className={`check ${ok ? 'is-ok' : 'is-off'}`}
      variants={{ hidden: { opacity: 0, x: -6 }, shown: { opacity: 1, x: 0 } }}
    >
      <span className="check__mark">
        <Icon name={ok ? 'check' : 'close'} size={11} />
      </span>
      <span className="check__text">{children}</span>
    </motion.li>
  );
}

/** The three things a join needs, each checked: Tailscale here, the inviter's device in sight, its app answering. */
function Preflight({ check, onRetry }: { check: Check; onRetry: () => void }) {
  const { t } = useTranslation();
  if (check.state === 'idle') return <TailscaleRow />;
  if (check.state === 'checking') {
    return (
      <div className="preflight l-card" role="status">
        <span className="preflight__wait">
          <Spinner />
          {t('join.checking')}
        </span>
      </div>
    );
  }
  if (check.state === 'bad') {
    return (
      <div className="preflight l-card is-bad" role="status">
        <span className="preflight__wait">
          <Icon name="alert" size={14} />
          {t('join.bad')}
        </span>
      </div>
    );
  }
  const r = check.result;
  const viaTailscale = TAILSCALE_IP.test(r.address);
  const ready = r.reachable && !r.joined;
  return (
    <div className={`preflight l-card ${ready ? 'is-ready' : ''}`}>
      <div className="preflight__head">
        <span className="preflight__ws">{r.name.slice(0, 2)}</span>
        <div className="preflight__name">
          <b>{r.name}</b>
          <span className="l-mono">{r.address}</span>
        </div>
        <Button size="sm" variant="quiet" icon="refresh" onClick={onRetry}>
          {t('join.retry')}
        </Button>
      </div>
      <motion.ul
        className="preflight__list"
        variants={{ shown: { transition: { staggerChildren: 0.06 } } }}
        initial="hidden"
        animate="shown"
      >
        {viaTailscale && (
          <CheckRow ok={r.tailscale === 'running'}>
            {r.tailscale === 'running' ? t('join.tailscale.ok') : t(`join.tailscale.${r.tailscale}`)}
            {r.tailscale === 'missing' && (
              <button
                type="button"
                className="check__link"
                onClick={() => void window.lonca.shell.openExternal('https://tailscale.com/download')}
              >
                {t('tailscale.download')}
              </button>
            )}
          </CheckRow>
        )}
        {viaTailscale && r.tailscale === 'running' && (
          <CheckRow ok={Boolean(r.peer?.online)}>
            {r.peer
              ? t(r.peer.online ? 'join.peer.online' : 'join.peer.offline', { name: r.peer.name })
              : t('join.peer.unseen')}
            {!r.peer && (
              <button
                type="button"
                className="check__link"
                onClick={() => void window.lonca.shell.openExternal(SHARING)}
              >
                {t('join.peer.sharing')}
              </button>
            )}
          </CheckRow>
        )}
        <CheckRow ok={r.reachable}>{t(r.reachable ? 'join.reach.ok' : 'join.reach.off')}</CheckRow>
        {r.joined && <CheckRow ok={false}>{t('errors.already_member')}</CheckRow>}
      </motion.ul>
    </div>
  );
}

export function NewWorkspaceDialog() {
  const { t } = useTranslation();
  const createWorkspace = useApp((s) => s.createWorkspace);
  const joinWithCode = useApp((s) => s.joinWithCode);
  const linked = useApp((s) => s.joinCode);
  const [joining, setJoining] = useState(Boolean(linked));
  const [code, setCode] = useState(linked ?? '');
  const close = useCallback(() => useApp.setState({ newWorkspaceOpen: false, joinCode: undefined }), []);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [round, setRound] = useState(0);

  // An invite link that arrives while the dialog is open replaces what is in the box.
  useEffect(() => {
    if (!linked) return;
    setJoining(true);
    setCode(linked);
  }, [linked]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  // The pasted invite is read a moment after the typing stops; `round` asks again for the same code.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `round` is the retry button's trigger
  useEffect(() => {
    const pasted = code.trim();
    if (!joining || !pasted) {
      setCheck({ state: 'idle' });
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      setCheck({ state: 'checking' });
      try {
        const result = await core.call('invites.check', { code: pasted });
        if (live) setCheck({ state: 'done', result });
      } catch {
        if (live) setCheck({ state: 'bad' });
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [code, joining, round]);

  const blocked = joining && (check.state === 'bad' || (check.state === 'done' && check.result.joined));
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
        aria-label={joining ? t('workspaces.join') : t('shell.newWorkspace')}
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
                  // biome-ignore lint/a11y/noAutofocus: the dialog opens to have a code pasted
                  autoFocus
                  onChange={(e) => setCode(e.target.value)}
                />
                <span className="l-field__hint">{t('workspaces.codeHint', { prefix: INVITE_PREFIX })}</span>
              </div>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={check.state}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.08 } }}
                >
                  <Preflight check={check} onRetry={() => setRound((n) => n + 1)} />
                </motion.div>
              </AnimatePresence>
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
          <Button
            type="submit"
            variant="primary"
            busy={busy}
            disabled={joining ? !code.trim() || blocked : !name.trim()}
          >
            {joining ? t('workspaces.askToJoin') : t('workspaces.create')}
          </Button>
        </footer>
      </motion.form>
    </motion.div>
  );
}
