// Making or changing a project: its name, what it is, this computer's clone, and the areas (who mostly works on what).
import type { ProjectArea, ProjectView } from '@lonca/protocol';
import { Button, Icon, IconButton, TextField } from '@lonca/ui';
import { motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorLine } from '../parts';
import { useApp } from '../store';

export function ProjectDialog() {
  const { t } = useTranslation();
  const target = useApp((s) => s.projectDialog);
  const workspace = useApp((s) => s.workspace);
  const saveProject = useApp((s) => s.saveProject);
  const deleteProject = useApp((s) => s.deleteProject);
  const openProject = useApp((s) => s.openProject);
  const close = useCallback(() => useApp.getState().openProjectDialog(undefined), []);
  const existing: ProjectView | undefined = target && target !== 'new' ? target : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [folder, setFolder] = useState(existing?.folder ?? '');
  const [areas, setAreas] = useState<ProjectArea[]>(existing?.areas ?? []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const members = workspace?.members?.length
    ? workspace.members.map((m) => ({ device: m.device, name: m.name }))
    : workspace
      ? [{ device: workspace.me.id, name: workspace.me.name }]
      : [];

  return (
    <motion.div
      className="l-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <motion.form
        className="l-dialog agentform"
        role="dialog"
        aria-modal="true"
        aria-label={existing ? t('project.edit') : t('project.new')}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 460, damping: 34 } }}
        exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
        onSubmit={async (e) => {
          e.preventDefault();
          const saved = await saveProject({
            ...(existing ? { id: existing.id } : {}),
            name,
            description,
            areas: areas.filter((a) => a.path.trim()).map((a) => ({ ...a, path: a.path.trim() })),
            folder,
          });
          if (saved && !existing) openProject(saved.id);
        }}
      >
        <header className="agentform__head">
          <h2>{existing ? t('project.edit') : t('project.new')}</h2>
          <IconButton icon="close" label={t('common.close')} onClick={close} />
        </header>
        <div className="agentform__body">
          <TextField
            label={t('project.name')}
            value={name}
            maxLength={60}
            required
            onChange={(e) => setName(e.target.value)}
          />
          <div className="l-field">
            <label className="l-field__label" htmlFor="project-description">
              {t('project.description')}
            </label>
            <textarea
              id="project-description"
              className="l-input agentform__text proj__desc"
              value={description}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="l-field">
            <span className="l-field__label">{t('project.folder')}</span>
            <div className="folder__path l-card">
              <Icon name="folder" />
              <span className="l-mono">{folder || '—'}</span>
              {folder && (
                <Button size="sm" variant="quiet" onClick={() => setFolder('')}>
                  {t('project.clearFolder')}
                </Button>
              )}
              <Button
                size="sm"
                onClick={async () => {
                  const dir = await window.lonca.shell.pickFolder();
                  if (dir) setFolder(dir);
                }}
              >
                {t('agentForm.pick')}
              </Button>
            </div>
            <span className="l-field__hint">{t('project.folderHint')}</span>
          </div>
          <fieldset className="l-field proj__areaform">
            <legend className="l-field__label">{t('project.areas')}</legend>
            {areas.map((a, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity besides their place
              <div key={i} className="proj__arearow">
                <input
                  className="l-input l-mono"
                  value={a.path}
                  maxLength={200}
                  placeholder="src/ui"
                  aria-label={t('project.areaPath')}
                  onChange={(e) => setAreas(areas.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)))}
                />
                <select
                  className="l-input"
                  value={a.member ?? ''}
                  aria-label={t('project.areaMember')}
                  onChange={(e) =>
                    setAreas(
                      areas.map((x, j) => {
                        if (j !== i) return x;
                        const { member: _m, ...rest } = x;
                        return e.target.value ? { ...rest, member: e.target.value } : rest;
                      }),
                    )
                  }
                >
                  <option value="">{t('project.shared')}</option>
                  {members.map((m) => (
                    <option key={m.device} value={m.device}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <input
                  className="l-input"
                  value={a.note}
                  maxLength={300}
                  placeholder={t('project.areaNote')}
                  aria-label={t('project.areaNote')}
                  onChange={(e) => setAreas(areas.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))}
                />
                <IconButton
                  size="sm"
                  icon="close"
                  label={t('project.removeRow')}
                  onClick={() => setAreas(areas.filter((_, j) => j !== i))}
                />
              </div>
            ))}
            <Button size="sm" variant="quiet" icon="plus" onClick={() => setAreas([...areas, { path: '', note: '' }])}>
              {t('project.addArea')}
            </Button>
            <span className="l-field__hint">{t('project.areasHint')}</span>
          </fieldset>
          {!existing && <p className="muted proj__seed">{t('project.seedHint')}</p>}
          <ErrorLine />
        </div>
        <footer className="agentform__foot">
          {existing ? (
            <Button variant="danger" icon="trash" onClick={() => void deleteProject(existing.id)}>
              {t('project.delete')}
            </Button>
          ) : (
            <span />
          )}
          <span className="grow" />
          <Button variant="quiet" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            {t('project.save')}
          </Button>
        </footer>
      </motion.form>
    </motion.div>
  );
}
