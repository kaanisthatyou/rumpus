// Invites to a team lonca (admins): a role, how long the code lasts, and the one-time code to send.
import { MEMBER_ROLES, type MemberRole } from '@lonca/protocol';
import { Button, Icon, IconButton, Segmented } from '@lonca/ui';
import { motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorLine, TailscaleRow } from '../parts';
import { useApp } from '../store';

const HOURS = ['1', '24', '72'] as const;

export function InviteDialog() {
  const { t } = useTranslation();
  const createInvite = useApp((s) => s.createInvite);
  const workspace = useApp((s) => s.workspace);
  const close = useCallback(() => useApp.setState({ inviteOpen: false }), []);
  const [role, setRole] = useState<MemberRole>('editor');
  const [hours, setHours] = useState<(typeof HOURS)[number]>('24');
  const [invite, setInvite] = useState<{ code: string; link: string }>();
  const code = invite?.code;
  const setCode = (_none: undefined) => setInvite(undefined);
  const [copied, setCopied] = useState<'code' | 'link' | 'message'>();
  const copy = async (what: 'code' | 'link' | 'message', text: string) => {
    await window.lonca.shell.copy(text);
    setCopied(what);
  };
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const personal = workspace?.kind !== 'team';
  return (
    <motion.div
      className="l-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <motion.div
        className="l-dialog agentform"
        role="dialog"
        aria-modal="true"
        aria-label={t('invite.title')}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 460, damping: 34 } }}
        exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
      >
        <header className="agentform__head">
          <h2>{t('invite.title')}</h2>
          <IconButton icon="close" label={t('common.close')} onClick={close} />
        </header>
        <div className="agentform__body">
          {personal ? (
            <>
              <p className="muted">{t('invite.personal')}</p>
              <div>
                <Button
                  icon="plus"
                  onClick={() => {
                    close();
                    useApp.setState({ newWorkspaceOpen: true });
                  }}
                >
                  {t('shell.newWorkspace')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="muted">{t('invite.intro', { name: workspace?.name ?? '' })}</p>
              <div className="l-field">
                <span className="l-field__label">{t('invite.role')}</span>
                <Segmented
                  layoutId="invite-role"
                  label={t('invite.role')}
                  value={role}
                  onChange={(r) => {
                    setRole(r);
                    setCode(undefined);
                  }}
                  options={MEMBER_ROLES.map((r) => ({ value: r, label: t(`shell.role.${r}`) }))}
                />
                <span className="l-field__hint">{t(`invite.roleHint.${role}`)}</span>
              </div>
              <div className="l-field">
                <span className="l-field__label">{t('invite.valid')}</span>
                <Segmented
                  layoutId="invite-hours"
                  label={t('invite.valid')}
                  value={hours}
                  onChange={(h) => {
                    setHours(h);
                    setCode(undefined);
                  }}
                  options={HOURS.map((h) => ({ value: h, label: t('invite.hours', { count: Number(h) }) }))}
                />
              </div>
              {invite ? (
                <motion.div className="invite__code" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                  <textarea
                    className="l-input l-mono"
                    readOnly
                    value={invite.code}
                    aria-label={t('invite.code')}
                    rows={3}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <div className="invite__copy">
                    <Button
                      variant="primary"
                      icon={copied === 'message' ? 'check' : 'chat'}
                      onClick={() =>
                        void copy(
                          'message',
                          t('invite.message', {
                            name: workspace?.name ?? '',
                            code: invite.code,
                            link: invite.link,
                            count: Number(hours),
                          }),
                        )
                      }
                    >
                      {copied === 'message' ? t('common.copied') : t('invite.copyMessage')}
                    </Button>
                    <Button icon={copied === 'code' ? 'check' : 'copy'} onClick={() => void copy('code', invite.code)}>
                      {copied === 'code' ? t('common.copied') : t('invite.copyCode')}
                    </Button>
                    <Button icon={copied === 'link' ? 'check' : 'link'} onClick={() => void copy('link', invite.link)}>
                      {copied === 'link' ? t('common.copied') : t('invite.copyLink')}
                    </Button>
                  </div>
                  <ol className="invite__steps">
                    {(['tailscale', 'app', 'code'] as const).map((step, i) => (
                      <li key={step}>
                        <span className="invite__n l-mono">{i + 1}</span>
                        {t(`invite.steps.${step}`)}
                      </li>
                    ))}
                  </ol>
                  <p className="invite__after">
                    <Icon name="userPlus" size={13} />
                    {t('invite.next')}
                  </p>
                </motion.div>
              ) : null}
              <TailscaleRow />
            </>
          )}
          <ErrorLine />
        </div>
        <footer className="agentform__foot">
          <span className="grow" />
          <Button variant="quiet" onClick={close}>
            {t('common.close')}
          </Button>
          {!personal && (
            <Button
              variant="primary"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                const made = await createInvite(role, Number(hours));
                setBusy(false);
                if (made) {
                  setInvite(made);
                  setCopied(undefined);
                }
              }}
            >
              {code ? t('invite.again') : t('invite.make')}
            </Button>
          )}
        </footer>
      </motion.div>
    </motion.div>
  );
}
