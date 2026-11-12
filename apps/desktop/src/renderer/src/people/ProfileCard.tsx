// A person's profile as a card: banner, avatar, name in its color, status, roles and the lines about them.
// It opens next to the avatar or name that was clicked, and stands as the preview in Settings → Profile.
import type { RoleTag } from '@lonca/protocol';
import { Button, Chip } from '@lonca/ui';
import { motion } from 'motion/react';
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../store';
import { nameStyle, type Person, ProfileAvatar, RoleChip, useFace, usePerson } from './people';

const NO_ROLES: RoleTag[] = [];

export function ProfileView({
  person,
  onEdit,
  onAssign,
  allRoles = NO_ROLES,
}: {
  person: Person;
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
  const person = usePerson(at?.id ?? '', at?.name);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>();
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
    setPos({ left, top });
  }, [at]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useApp.setState({ profileCard: undefined });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!at) return null;
  const admin = workspace?.kind === 'team' && workspace.role === 'admin' && person.role !== undefined;
  return (
    <>
      <motion.button
        type="button"
        className="pcard-scrim"
        aria-label={t('common.close')}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={close}
      />
      <motion.div
        ref={box}
        className="pcard-pop"
        role="dialog"
        aria-label={t('profile.of', { name: person.name })}
        style={{
          left: pos?.left ?? at.x,
          top: pos?.top ?? at.y,
          // Never wider than the window (a phone).
          width: Math.min(WIDTH, window.innerWidth - GAP * 2),
          visibility: pos ? 'visible' : 'hidden',
        }}
        initial={{ opacity: 0, scale: 0.96, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 520, damping: 36 } }}
        exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
      >
        <ProfileView
          person={person}
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
      </motion.div>
    </>
  );
}
