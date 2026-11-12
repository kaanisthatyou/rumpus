// A team workspace as it presents itself: its name, a line about it, an icon for the rail, a banner, and its
// roles (names with a color that admins give to members). Everyone sees it; admins change it.
import { LIMITS, type RoleTag } from '@lonca/protocol';
import { Button, Counter, IconButton, TextField } from '@lonca/ui';
import { motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorLine } from '../parts';
import { ColorPick, nameStyle, PicturePick, useFace, WorkspaceIcon } from '../people/people';
import { useApp } from '../store';

function RoleRow({ role, admin }: { role: RoleTag; admin: boolean }) {
  const { t } = useTranslation();
  const saveRole = useApp((s) => s.saveRole);
  const deleteRole = useApp((s) => s.deleteRole);
  const members = useApp((s) => s.workspace?.members);
  const [name, setName] = useState(role.name);
  const [coloring, setColoring] = useState(false);
  useEffect(() => setName(role.name), [role.name]);
  const carried = members?.filter((m) => m.roles?.includes(role.id)).length ?? 0;
  const keep = () => {
    const clean = name.trim();
    if (!clean) setName(role.name);
    else if (clean !== role.name) void saveRole({ id: role.id, name: clean, color: role.color });
  };
  if (!admin) {
    return (
      <li className="role">
        <span className="rolechip" style={nameStyle(role.color)}>
          <span className="rolechip__dot" aria-hidden="true" />
          {role.name}
        </span>
        <span className="grow" />
        <span className="role__count">{t('wsForm.carried', { count: carried })}</span>
      </li>
    );
  }
  return (
    <li className="role role--edit">
      <div className="role__line">
        <button
          type="button"
          className="role__dot"
          style={nameStyle(role.color)}
          aria-label={t('wsForm.roleColor', { name: role.name })}
          title={t('wsForm.roleColor', { name: role.name })}
          aria-expanded={coloring}
          onClick={() => setColoring((v) => !v)}
        />
        <input
          className="l-input grow"
          value={name}
          maxLength={LIMITS.roleName}
          aria-label={t('wsForm.roleNameOf', { name: role.name })}
          onChange={(e) => setName(e.target.value)}
          onBlur={keep}
          onKeyDown={(e) => e.key === 'Enter' && keep()}
        />
        <span className="role__count">{t('wsForm.carried', { count: carried })}</span>
        <IconButton
          size="sm"
          icon="trash"
          label={t('wsForm.roleDelete', { name: role.name })}
          onClick={() => void deleteRole(role.id)}
        />
      </div>
      {coloring && (
        <ColorPick
          label={t('wsForm.roleColor', { name: role.name })}
          value={role.color}
          none={t('profile.colorNone')}
          onChange={(color) => void saveRole({ id: role.id, name: role.name, color })}
        />
      )}
    </li>
  );
}

export function WorkspaceDialog() {
  const { t } = useTranslation();
  const workspace = useApp((s) => s.workspace);
  const saveLook = useApp((s) => s.saveLook);
  const setWorkspacePicture = useApp((s) => s.setWorkspacePicture);
  const saveRole = useApp((s) => s.saveRole);
  const close = useCallback(() => useApp.setState({ workspaceDialog: false }), []);
  const [name, setName] = useState(workspace?.name ?? '');
  const [about, setAbout] = useState(workspace?.about ?? '');
  const [role, setRole] = useState('');
  const [roleColor, setRoleColor] = useState('');
  const banner = useFace(workspace?.banner, true);

  useEffect(() => setName(workspace?.name ?? ''), [workspace?.name]);
  useEffect(() => setAbout(workspace?.about ?? ''), [workspace?.about]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  if (workspace?.kind !== 'team') return null;
  const admin = workspace.role === 'admin';
  const roles = workspace.roles ?? [];
  const members = workspace.members ?? [];
  const keepName = () => {
    const clean = name.trim();
    if (!clean) setName(workspace.name);
    else if (clean !== workspace.name) void saveLook({ name: clean });
  };
  const keepAbout = () => {
    if (about.trim() !== (workspace.about ?? '')) void saveLook({ about: about.trim() });
  };
  return (
    <motion.div
      className="l-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <motion.div
        className="l-dialog agentform wsdialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('wsForm.title')}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 460, damping: 34 } }}
        exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
      >
        <header className="agentform__head">
          <h2>{t('wsForm.title')}</h2>
          <IconButton icon="close" label={t('common.close')} onClick={close} />
        </header>
        <div className="agentform__body">
          <div className="wshead">
            <div
              className={`wshead__banner ${banner ? 'has-picture' : ''}`}
              style={banner ? { backgroundImage: `url("${banner}")` } : undefined}
            />
            <div className="wshead__row">
              <span className="wshead__icon">
                <WorkspaceIcon name={workspace.name} icon={workspace.icon} />
              </span>
              <div className="wshead__text">
                <b>{workspace.name}</b>
                <span>
                  {t('inviteCard.members', { count: members.length })} ·{' '}
                  {t('inviteCard.online', { count: members.filter((m) => m.online).length })}
                </span>
              </div>
            </div>
            {workspace.about && <p className="wshead__about l-selectable">{workspace.about}</p>}
          </div>
          {admin ? (
            <>
              <TextField
                label={t('wsForm.name')}
                value={name}
                maxLength={LIMITS.workspaceName}
                counted
                onChange={(e) => setName(e.target.value)}
                onBlur={keepName}
                onKeyDown={(e: { key: string }) => e.key === 'Enter' && keepName()}
              />
              <div className="l-field">
                <span className="l-field__top">
                  <label className="l-field__label" htmlFor="ws-about">
                    {t('wsForm.about')}
                  </label>
                  <Counter value={about.length} max={LIMITS.workspaceAbout} />
                </span>
                <textarea
                  id="ws-about"
                  className="l-input agentform__text"
                  rows={3}
                  maxLength={LIMITS.workspaceAbout}
                  placeholder={t('wsForm.aboutPlaceholder')}
                  value={about}
                  onChange={(e) => setAbout(e.target.value)}
                  onBlur={keepAbout}
                />
              </div>
              <div className="wsdialog__pics">
                <PicturePick
                  label={t('wsForm.icon')}
                  shape="icon"
                  has={Boolean(workspace.icon)}
                  onPick={(data) => setWorkspacePicture('icon', data)}
                />
                <PicturePick
                  label={t('wsForm.banner')}
                  shape="banner"
                  has={Boolean(workspace.banner)}
                  onPick={(data) => setWorkspacePicture('banner', data)}
                />
                <p className="muted">{t('profile.pictureHint')}</p>
              </div>
            </>
          ) : (
            <p className="muted">{t('wsForm.adminOnly')}</p>
          )}
          <section className="roles" aria-label={t('wsForm.roles')}>
            <h3>
              <span className="grow">{t('wsForm.roles')}</span>
              <span className="l-mono">
                {roles.length} / {LIMITS.roles}
              </span>
            </h3>
            <p className="muted">{t('wsForm.rolesHint')}</p>
            {roles.length === 0 ? (
              <p className="crew__none">{t('wsForm.noRoles')}</p>
            ) : (
              <ul className="roles__list">
                {roles.map((r) => (
                  <RoleRow key={r.id} role={r} admin={admin} />
                ))}
              </ul>
            )}
            {admin && roles.length < LIMITS.roles && (
              <form
                className="roles__add"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!role.trim()) return;
                  if (await saveRole({ name: role.trim(), color: roleColor })) {
                    setRole('');
                    setRoleColor('');
                  }
                }}
              >
                <div className="role__line">
                  <input
                    className="l-input grow"
                    value={role}
                    maxLength={LIMITS.roleName}
                    placeholder={t('wsForm.roleName')}
                    aria-label={t('wsForm.roleName')}
                    onChange={(e) => setRole(e.target.value)}
                  />
                  <Counter value={role.length} max={LIMITS.roleName} />
                  <Button size="sm" icon="plus" type="submit" disabled={!role.trim()}>
                    {t('wsForm.roleAdd')}
                  </Button>
                </div>
                {role.trim() && (
                  <ColorPick
                    label={t('wsForm.newRoleColor')}
                    value={roleColor}
                    none={t('profile.colorNone')}
                    onChange={setRoleColor}
                  />
                )}
              </form>
            )}
            {admin && <p className="muted">{t('wsForm.assignHint')}</p>}
          </section>
          <ErrorLine />
        </div>
        <footer className="agentform__foot">
          {admin && (
            <Button
              icon="userPlus"
              onClick={() => {
                close();
                useApp.setState({ inviteOpen: true });
              }}
            >
              {t('shell.invite')}
            </Button>
          )}
          <span className="grow" />
          <Button variant="quiet" onClick={close}>
            {t('common.close')}
          </Button>
        </footer>
      </motion.div>
    </motion.div>
  );
}
