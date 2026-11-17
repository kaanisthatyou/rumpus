// A person's profile as a card: banner, avatar, name in its color, status, roles and the lines about them.
// It opens next to the avatar or name that was clicked (or right-clicked), and stands as the preview in
// Settings → Profile. An agent's card shows who it is, the login it runs on and that login's quota, and
// leads to its channel. The card is no modal: the page under it stays in use.
import type { Agent, RoleTag } from '@lonca/protocol';
import { Avatar, Button, Chip } from '@lonca/ui';
import { motion } from 'motion/react';
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { remoteOwner } from '../agents/owner';
import { specialistIcon } from '../agents/SpecialistDialog';
import { QuotaBars, QuotaBlock, quotaWindows } from '../shell/quota';
import { useApp } from '../store';
import { nameStyle, type Person, ProfileAvatar, RoleChip, useFace, usePerson } from './people';

const NO_ROLES: RoleTag[] = [];

export function ProfileView({
  person,
  onEdit,
  onAssign,
  allRoles = NO_ROLES,
  extra,
}: {
  person: Person;
  /** More sections under the profile's own (the person's quota on the popover). */
  extra?: ReactNode;
  /** Shown on the person's own card: opens the profile's settings. */
  onEdit?: () => void;
  /** Given to admins looking at a member: the roles to carry from now on. */
  onAssign?: (roles: string[]) => void;
  allRoles?: RoleTag[];
}) {
  const { t } = useTranslation();
  const { profile } = person;
  const banner = useFace(profile.banner, true);
  const [first, second] = profile.theme;
  const themed = Boolean(first && second);
  const style = {
    ...(themed ? { '--p1': first, '--p2': second } : {}),
    ...(profile.color ? { '--name': profile.color } : {}),
  } as CSSProperties;
  const presence = person.online === undefined ? undefined : person.online ? 'on' : 'off';
  const carried = new Set(person.roles.map((r) => r.id));
  return (
    <div className={`pcard ${themed ? 'pcard--themed' : ''}`} style={style}>
      <div
        className={`pcard__banner ${banner ? 'has-picture' : ''}`}
        style={banner ? { backgroundImage: `url("${banner}")` } : undefined}
      />
      <div className="pcard__body">
        <div className="pcard__face">
          <ProfileAvatar profile={profile} name={person.name} size={72} presence={presence} play />
        </div>
        <div className="pcard__who">
          <h3 className={person.color ? 'named' : ''} style={nameStyle(person.color)}>
            {person.name}
          </h3>
          <p className="pcard__sub">
            {[
              profile.pronouns,
              person.me ? t('members.me') : '',
              presence ? t(presence === 'on' ? 'profile.online' : 'profile.offline') : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {profile.status && <p className="pcard__status">{profile.status}</p>}
        {(person.role || person.roles.length > 0) && (
          <div className="pcard__chips">
            {person.role && <Chip>{t(`shell.role.${person.role}`)}</Chip>}
            {person.roles.map((r) => (
              <RoleChip key={r.id} role={r} />
            ))}
          </div>
        )}
        {profile.bio && (
          <section className="pcard__section">
            <h4>{t('profile.bio')}</h4>
            <p className="pcard__bio l-selectable">{profile.bio}</p>
          </section>
        )}
        {onAssign && allRoles.length > 0 && (
          <section className="pcard__section">
            <h4>{t('profile.roles')}</h4>
            <div className="pcard__assign">
              {allRoles.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="rolechip rolechip--toggle"
                  style={nameStyle(r.color)}
                  aria-pressed={carried.has(r.id)}
                  onClick={() =>
                    onAssign(
                      carried.has(r.id)
                        ? person.roles.filter((x) => x.id !== r.id).map((x) => x.id)
                        : [...person.roles.map((x) => x.id), r.id],
                    )
                  }
                >
                  <span className="rolechip__dot" aria-hidden="true" />
                  {r.name}
                </button>
              ))}
            </div>
          </section>
        )}
        {extra}
        {onEdit && (
          <div className="pcard__foot">
            <Button size="sm" icon="pencil" onClick={onEdit}>
              {t('profile.edit')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

const WIDTH = 300;
const GAP = 10;

/** The card over the page, next to what was clicked; it stays inside the window. Rendered from App.tsx. */
export function ProfilePopover() {
  const { t } = useTranslation();
  const at = useApp((s) => s.profileCard);
  const workspace = useApp((s) => s.workspace);
  const assignRoles = useApp((s) => s.assignRoles);
  const person = usePerson(at?.agent ? '' : (at?.id ?? ''), at?.name);
  const agent = useApp((s) => (at?.agent ? s.workspace?.agents.find((a) => a.id === at.id) : undefined));
  const team = workspace?.kind === 'team';
  const other = Boolean(at && !at.agent && !person.me);
  // Another member's quota comes with their computer's status, asked for when their card opens.
  useEffect(() => {
    if (team && other) void useApp.getState().loadStatus();
  }, [team, other]);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string }>();
  const close = () => useApp.setState({ profileCard: undefined });

  useLayoutEffect(() => {
    if (!at || !box.current) return;
    const height = box.current.offsetHeight;
    // To the right of what was clicked, else to its left; never past the window's edges.
    const width = box.current.offsetWidth;
    const fitsRight = at.x + width + GAP <= window.innerWidth;
    const fitsLeft = at.left - width >= GAP;
    const left = fitsRight ? at.x : fitsLeft ? at.left - width : Math.max(GAP, window.innerWidth - width - GAP);
    const top = Math.max(GAP + 36, Math.min(at.y, window.innerHeight - height - GAP));
    setPos({ left, top, origin: fitsRight ? 'top left' : 'top right' });
  }, [at]);

  useEffect(() => {
    const shut = () => useApp.setState({ profileCard: undefined });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && shut();
    // The card is no modal: a press anywhere else closes it and still does what it was meant to do. A press
    // on an opener (`data-card`) is left to the opener, which moves the card or closes it.
    const onDown = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target && (box.current?.contains(target) || target.closest('[data-card]'))) return;
      shut();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, []);

  if (!at || (at.agent && !agent)) return null;
  const admin = workspace?.kind === 'team' && workspace.role === 'admin' && person.role !== undefined;
  return (
    <motion.div
      ref={box}
      className="pcard-pop"
      role="dialog"
      aria-label={t('profile.of', { name: agent ? agent.name : person.name })}
      style={{
        left: pos?.left ?? at.x,
        top: pos?.top ?? at.y,
        // Never wider than the window (a phone).
        width: Math.min(WIDTH, window.innerWidth - GAP * 2),
        visibility: pos ? 'visible' : 'hidden',
        transformOrigin: pos?.origin ?? 'top left',
      }}
      initial={{ opacity: 0, scale: 0.96, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 520, damping: 36 } }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
    >
      {agent ? (
        <AgentView agent={agent} onClose={close} />
      ) : (
        <ProfileView
          person={person}
          extra={<PersonQuota id={person.id} me={person.me} />}
          {...(person.me
            ? {
                onEdit: () => {
                  close();
                  useApp.setState({ settingsTab: 'profile' });
                },
              }
            : {})}
          {...(admin ? { onAssign: (roles: string[]) => void assignRoles(person.id, roles) } : {})}
          {...(workspace?.roles ? { allRoles: workspace.roles } : {})}
        />
      )}
    </motion.div>
  );
}

/** A person's CLI quota: this computer's logins for oneself, what their computer last reported for a member. */
function PersonQuota({ id, me }: { id: string; me: boolean }) {
  const { t } = useTranslation();
  const quota = useApp((s) => s.quota);
  const status = useApp((s) => (me ? undefined : s.statuses.find((x) => x.device === id)));
  const mine = me ? Object.entries(quota).filter(([, q]) => quotaWindows(q).length > 0) : [];
  const theirs = (status?.quotas ?? []).filter((q) => quotaWindows(q.quota).length > 0);
  if (mine.length === 0 && theirs.length === 0) return null;
  return (
    <section className="pcard__section">
      <h4>{t('profile.quota')}</h4>
      {mine.map(([key, q]) => (
        <QuotaBlock key={key} id={key} quota={q} />
      ))}
      {theirs.map((q) => (
        <QuotaBars
          key={`${q.kind}-${q.account ?? ''}`}
          title={t('quota.title', {
            cli: q.account ? `${t(`agent.kind.${q.kind}`)} · ${q.account}` : t(`agent.kind.${q.kind}`),
          })}
          quota={q.quota}
        />
      ))}
    </section>
  );
}

const loginKey = (agent: Agent, account: string | undefined) => (account ? `${agent.kind}:${account}` : agent.kind);

/** An agent as a card: name, handle, CLI and state, whose computer it runs on, its login and that login's quota. */
function AgentView({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const { t } = useTranslation();
  const workspace = useApp((s) => s.workspace);
  const quota = useApp((s) => s.quota);
  const jobs = useApp((s) => s.jobs);
  const accounts = useApp((s) => s.accounts);
  const statuses = useApp((s) => s.statuses);
  const owner = remoteOwner(agent, workspace);
  const busy = Object.values(jobs).some(
    (j) => j.agentId === agent.id && (j.state === 'running' || j.state === 'attention'),
  );
  const channel = workspace?.channels.find((c) => c.kind === 'agent' && c.agentId === agent.id);
  const loginName = (account: string | undefined) =>
    account ? (accounts.find((a) => a.id === account)?.name ?? account) : t('profile.defaultLogin');
  // This computer knows its own logins' quota. Another member's agent shows what their computer last reported for
  // its default login; an extra login's id means nothing on this computer.
  const remote = owner ? statuses.find((x) => x.device === agent.owner) : undefined;
  const remoteQuota = remote?.quotas.find((q) => q.kind === agent.kind && !q.account && !agent.account)?.quota;
  const own = owner ? remoteQuota : quota[loginKey(agent, agent.account)];
  const spare = !owner && agent.spare !== undefined ? quota[loginKey(agent, agent.spare || undefined)] : undefined;
  const cli = t(`agent.kind.${agent.kind}`);
  return (
    <div className="pcard pcard--agent">
      <div className="pcard__banner" />
      <div className="pcard__body">
        <div className="pcard__face">
          <Avatar
            name=""
            icon={agent.specialty ? specialistIcon(agent) : 'terminal'}
            size={72}
            presence={busy ? 'busy' : 'on'}
          />
        </div>
        <div className="pcard__who">
          <h3>{agent.name}</h3>
          <p className="pcard__sub">
            <span className="l-mono">@{agent.handle}</span> · {cli} · {t(busy ? 'crew.running' : 'crew.idle')}
          </p>
        </div>
        <div className="pcard__chips">
          {owner && <Chip>{t('agent.on', { name: owner })}</Chip>}
          {!owner && <Chip>{`${t('profile.login')}: ${loginName(agent.account)}`}</Chip>}
          {!owner && agent.spare !== undefined && (
            <Chip>{`${t('profile.spare')}: ${loginName(agent.spare || undefined)}`}</Chip>
          )}
        </div>
        <section className="pcard__section">
          <h4>{t('profile.quota')}</h4>
          {quotaWindows(own).length > 0 ? (
            <QuotaBars title={`${cli} · ${owner ? owner : loginName(agent.account)}`} quota={own} />
          ) : (
            <p className="pcard__sub">{t('profile.noQuota')}</p>
          )}
          {quotaWindows(spare).length > 0 && (
            <QuotaBars title={`${t('profile.spare')} · ${loginName(agent.spare || undefined)}`} quota={spare} />
          )}
        </section>
        <div className="pcard__foot">
          {channel && (
            <Button
              size="sm"
              variant="primary"
              icon="chat"
              onClick={() => {
                onClose();
                void useApp.getState().openChannel(channel.id);
              }}
            >
              {t('profile.openChannel')}
            </Button>
          )}
          {!owner && (
            <Button
              size="sm"
              icon="settings"
              onClick={() => {
                onClose();
                useApp.getState().openAgentDialog(agent);
              }}
            >
              {t('agentForm.edit')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
