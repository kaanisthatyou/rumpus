// An invite written in a message, shown as a card: the workspace it is for (its icon, its name, a line about it,
// how many members it has and how many are there now) and one button. The inviter's app is asked about the
// invite when the card first shows; nothing is used up by looking.
import type { InviteCheck } from '@lonca/protocol';
import { Button, Icon, Spinner } from '@lonca/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { core } from '../rpc';
import { useApp } from '../store';

type Check = { state: 'checking' } | { state: 'bad' } | { state: 'done'; result: InviteCheck };

/** What each invite said, so a channel scrolled past twice does not ask twice. */
const seen = new Map<string, InviteCheck>();

export function InviteCard({ code }: { code: string }) {
  const { t } = useTranslation();
  const workspaces = useApp((s) => s.workspaces);
  const openWorkspace = useApp((s) => s.openWorkspace);
  const joinWithCode = useApp((s) => s.joinWithCode);
  const [check, setCheck] = useState<Check>(() => {
    const known = seen.get(code);
    return known ? { state: 'done', result: known } : { state: 'checking' };
  });
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);

  // `round` asks again for the same code.
  useEffect(() => {
    if (round === 0 && seen.has(code)) return;
    let live = true;
    setCheck({ state: 'checking' });
    core
      .call('invites.check', { code })
      .then((result) => {
        if (result.reachable) seen.set(code, result);
        if (live) setCheck({ state: 'done', result });
      })
      .catch(() => live && setCheck({ state: 'bad' }));
    return () => {
      live = false;
    };
  }, [code, round]);

  if (check.state === 'checking') {
    return (
      <div className="invcard invcard--wait" role="status">
        <Spinner />
        {t('inviteCard.checking')}
      </div>
    );
  }
  if (check.state === 'bad') {
    return (
      <div className="invcard invcard--off">
        <Icon name="alert" size={14} />
        {t('inviteCard.bad')}
      </div>
    );
  }
  const r = check.result;
  // Whether this computer has the workspace is read from the rail's list, so the card follows a join at once.
  const mine = workspaces.find((w) => w.id === r.workspace);
  const dead = r.invite && r.invite.state !== 'valid';
  const note =
    mine?.state === 'joining'
      ? t('inviteCard.waiting')
      : mine?.state === 'denied'
        ? t('workspaces.state.denied')
        : mine
          ? t('inviteCard.joined')
          : dead
            ? t(`inviteCard.${r.invite?.state === 'used' ? 'used' : 'expired'}`)
            : !r.reachable
              ? t('inviteCard.unreachable')
              : r.invite?.role
                ? t('inviteCard.as', { role: t(`shell.role.${r.invite.role}`) })
                : '';
  return (
    <div className={`invcard ${mine || dead || !r.reachable ? '' : 'invcard--live'}`}>
      <span className="invcard__label">{t('inviteCard.label')}</span>
      <div className="invcard__row">
        <span className="invcard__icon">
          {r.invite?.icon ? <img src={r.invite.icon} alt="" draggable={false} /> : r.name.slice(0, 2)}
        </span>
        <div className="invcard__text">
          <b>{r.name}</b>
          {r.invite?.members !== undefined && (
            <span className="invcard__counts">
              <span className="dot dot--ok" />
              {t('inviteCard.online', { count: r.invite.online ?? 0 })}
              <span className="dot" />
              {t('inviteCard.members', { count: r.invite.members })}
            </span>
          )}
          {note && <span className="invcard__note">{note}</span>}
        </div>
        {mine && !mine.state ? (
          <Button size="sm" onClick={() => void openWorkspace(mine.id)}>
            {t('inviteCard.open')}
          </Button>
        ) : mine || dead ? null : r.reachable ? (
          <Button
            size="sm"
            variant="primary"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              const sent = await joinWithCode(code);
              setBusy(false);
              seen.delete(code);
              // Refused or out of reach: the invite is read again, so the card says why.
              if (!sent) setRound((n) => n + 1);
            }}
          >
            {t('inviteCard.join')}
          </Button>
        ) : (
          <Button size="sm" variant="quiet" icon="refresh" onClick={() => setRound((n) => n + 1)}>
            {t('inviteCard.retry')}
          </Button>
        )}
      </div>
      {r.invite?.about && <p className="invcard__about">{r.invite.about}</p>}
    </div>
  );
}
