// Friends (PLAN.md 5.20): people added outside any workspace. This person's own code to hand out, a box for
// someone else's, the requests on their way, and the friends, each with the conversation the two share.
import { FRIEND_PREFIX, type FriendsState, type ImageRef } from '@lonca/protocol';
import { Avatar, Button, Icon, IconButton } from '@lonca/ui';
import { motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorLine, TailscaleRow } from '../parts';
import { useFace } from '../people/people';
import { useApp } from '../store';

/** A friend's avatar: their picture when it has arrived, else the first letter of their name. */
export function FriendAvatar({
  name,
  avatar,
  size = 28,
  online,
}: {
  name: string;
  avatar?: ImageRef | undefined;
  size?: number;
  online?: boolean | undefined;
}) {
  const [over, setOver] = useState(false);
  const src = useFace(avatar, over);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the pointer only starts a moving picture; nothing to operate
    <span className="face" onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}>
      <Avatar
        name={name}
        size={size}
        src={src}
        {...(online === undefined ? {} : { presence: online ? ('on' as const) : ('off' as const) })}
      />
    </span>
  );
}

const NONE: FriendsState = { friends: [], requests: [], sent: [] };

export function FriendsDialog() {
  const { t } = useTranslation();
  const friends = useApp((s) => s.friends) ?? NONE;
  const loadFriends = useApp((s) => s.loadFriends);
  const addFriend = useApp((s) => s.addFriend);
  const answerFriend = useApp((s) => s.answerFriend);
  const cancelFriend = useApp((s) => s.cancelFriend);
  const removeFriend = useApp((s) => s.removeFriend);
  const openWorkspace = useApp((s) => s.openWorkspace);
  const close = useCallback(() => useApp.setState({ friendsOpen: false }), []);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState<string>();

  // Opening the friends is what starts the app listening for them.
  useEffect(() => {
    void loadFriends(true);
  }, [loadFriends]);
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
      <motion.div
        className="l-dialog agentform friends"
        role="dialog"
        aria-modal="true"
        aria-label={t('friends.title')}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 460, damping: 34 } }}
        exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
      >
        <header className="agentform__head">
          <h2>{t('friends.title')}</h2>
          <IconButton icon="close" label={t('common.close')} onClick={close} />
        </header>
        <div className="agentform__body">
          <p className="muted">{t('friends.intro')}</p>
          <section className="friends__part">
            <h3>{t('friends.myCode')}</h3>
            {friends.code ? (
              <div className="friends__code">
                <textarea
                  className="l-input l-mono"
                  readOnly
                  rows={2}
                  value={friends.code}
                  aria-label={t('friends.myCode')}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  icon={copied ? 'check' : 'copy'}
                  onClick={async () => {
                    await window.lonca.shell.copy(friends.code ?? '');
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? t('common.copied') : t('common.copy')}
                </Button>
              </div>
            ) : (
              <>
                <p className="muted">{t('friends.noCode')}</p>
                <TailscaleRow />
              </>
            )}
          </section>
          <section className="friends__part">
            <h3>{t('friends.add')}</h3>
            <form
              className="friends__add"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!code.trim()) return;
                setBusy(true);
                const ok = await addFriend(code.trim());
                setBusy(false);
                if (ok) setCode('');
              }}
            >
              <input
                className="l-input l-mono grow"
                value={code}
                spellCheck={false}
                placeholder={t('friends.codePlaceholder', { prefix: FRIEND_PREFIX })}
                aria-label={t('friends.theirCode')}
                onChange={(e) => setCode(e.target.value)}
              />
              <Button type="submit" variant="primary" icon="userPlus" busy={busy} disabled={!code.trim()}>
                {t('friends.send')}
              </Button>
            </form>
            <p className="muted">{t('friends.addHint')}</p>
          </section>
          {friends.requests.length > 0 && (
            <section className="friends__part">
              <h3>{t('friends.requests')}</h3>
              <ul className="friends__list" aria-label={t('friends.requests')}>
                {friends.requests.map((r) => (
                  <li key={r.id} className="friend">
                    <Avatar name={r.name} size={28} />
                    <div className="who__text">
                      <b>{r.name}</b>
                      <span>{t('friends.asks')}</span>
                    </div>
                    <Button size="sm" variant="quiet" onClick={() => void answerFriend(r.id, false)}>
                      {t('invite.deny')}
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => void answerFriend(r.id, true)}>
                      {t('friends.accept')}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {friends.sent.length > 0 && (
            <section className="friends__part">
              <h3>{t('friends.sent')}</h3>
              <ul className="friends__list" aria-label={t('friends.sent')}>
                {friends.sent.map((s) => (
                  <li key={s.device} className="friend">
                    <Avatar name={s.name} size={28} />
                    <div className="who__text">
                      <b>{s.name}</b>
                      <span>{t('friends.waiting')}</span>
                    </div>
                    <Button size="sm" variant="quiet" onClick={() => void cancelFriend(s.device)}>
                      {t('friends.withdraw')}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="friends__part">
            <h3>
              <span className="grow">{t('friends.list')}</span>
              <span className="l-mono">{friends.friends.length}</span>
            </h3>
            {friends.friends.length === 0 ? (
              <p className="crew__none">{t('friends.none')}</p>
            ) : (
              <ul className="friends__list" aria-label={t('friends.list')}>
                {friends.friends.map((f) => (
                  <li key={f.device} className="friend">
                    <FriendAvatar name={f.name} avatar={f.avatar} online={f.online} />
                    <div className="who__text">
                      <b>{f.name}</b>
                      <span>{t(f.online ? 'profile.online' : 'profile.offline')}</span>
                    </div>
                    {leaving === f.device ? (
                      <>
                        <Button size="sm" variant="quiet" onClick={() => setLeaving(undefined)}>
                          {t('common.cancel')}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={async () => {
                            await removeFriend(f.device);
                            setLeaving(undefined);
                          }}
                        >
                          {t('friends.removeSure')}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          icon="chat"
                          onClick={() => {
                            close();
                            void openWorkspace(f.workspace);
                          }}
                        >
                          {t('friends.message')}
                        </Button>
                        <IconButton
                          size="sm"
                          icon="trash"
                          label={t('friends.remove', { name: f.name })}
                          onClick={() => setLeaving(f.device)}
                        />
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <ErrorLine />
        </div>
        <footer className="agentform__foot">
          <Icon name="network" size={14} />
          <span className="muted grow friends__foot">{t('friends.how')}</span>
          <Button variant="quiet" onClick={close}>
            {t('common.close')}
          </Button>
        </footer>
      </motion.div>
    </motion.div>
  );
}
