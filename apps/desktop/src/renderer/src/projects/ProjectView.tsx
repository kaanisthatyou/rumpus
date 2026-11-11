// A project (PLAN.md 5.13): this computer's clone and its git state, the status page (Fabrika's progress.md) and the
// areas (Fabrika's split.md). People edit the page here; agents keep it current through Rumpus's tools.
import type { GitState, ProjectView as Project } from '@lonca/protocol';
import { Button, Icon, IconButton } from '@lonca/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { core } from '../rpc';
import { useApp } from '../store';

const NO_PROJECTS: Project[] = [];

function GitPanel({ project }: { project: Project }) {
  const { t } = useTranslation();
  const saveProject = useApp((s) => s.saveProject);
  const [git, setGit] = useState<GitState | undefined>();
  const [busy, setBusy] = useState<'fetch' | 'pull' | 'push' | undefined>();
  const [result, setResult] = useState<{ ok: boolean; text: string } | undefined>();
  const [failed, setFailed] = useState<string | undefined>();

  const load = useCallback(
    async (opts: { fetch?: boolean; force?: boolean } = {}) => {
      if (!project.folder) return;
      try {
        setGit(await core.call('projects.git', { id: project.id, ...opts }));
        setFailed(undefined);
      } catch (err) {
        setFailed((err as { code?: string }).code ?? 'internal');
      }
    },
    [project.id, project.folder],
  );
  useEffect(() => {
    setGit(undefined);
    setResult(undefined);
    void load({ fetch: true });
  }, [load]);

  if (!project.folder) {
    return (
      <section className="proj__git l-card" aria-label={t('project.git')}>
        <div className="proj__gitline">
          <Icon name="folder" size={14} />
          <span className="grow muted">{t('project.noFolder')}</span>
          <Button
            size="sm"
            icon="folder"
            onClick={async () => {
              const dir = await window.lonca.shell.pickFolder();
              if (dir)
                await saveProject({
                  id: project.id,
                  name: project.name,
                  description: project.description,
                  areas: project.areas,
                  folder: dir,
                });
            }}
          >
            {t('project.pickFolder')}
          </Button>
        </div>
      </section>
    );
  }

  const act = async (kind: 'pull' | 'push') => {
    setBusy(kind);
    try {
      const r = await core.call(kind === 'pull' ? 'projects.pull' : 'projects.push', { id: project.id });
      setGit(r.git);
      setResult({ ok: r.ok, text: r.ok ? t(`project.${kind}Done`) : r.output || t(`project.${kind}Failed`) });
    } catch (err) {
      setResult({ ok: false, text: t(`errors.${(err as { code?: string }).code ?? 'internal'}`) });
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section className="proj__git l-card" aria-label={t('project.git')}>
      <div className="proj__gitline">
        <Icon name="folder" size={14} />
        <span className="l-mono proj__folder" title={project.folder}>
          {project.folder}
        </span>
        <span className="grow" />
        <IconButton
          size="sm"
          icon="external"
          label={t('project.openFolder')}
          onClick={() => project.folder && void window.lonca.shell.openFolder(project.folder)}
        />
      </div>
      {failed ? (
        <p className="proj__gitnote is-bad">{t(`errors.${failed}`, t('errors.internal'))}</p>
      ) : !git ? (
        <p className="proj__gitnote muted">{t('project.reading')}</p>
      ) : !git.repo ? (
        <p className="proj__gitnote muted">{t('project.notRepo')}</p>
      ) : (
        <>
          <div className="proj__gitline">
            <Icon name="branch" size={14} />
            <b className="l-mono">{git.branch ?? t('project.detached')}</b>
            {git.upstream ? (
              <span className="muted l-mono">
                {t('project.aheadBehind', { ahead: git.ahead ?? 0, behind: git.behind ?? 0, upstream: git.upstream })}
              </span>
            ) : (
              <span className="muted">{t('project.noUpstream')}</span>
            )}
            <span className={`proj__changes ${(git.changes ?? 0) + (git.untracked ?? 0) > 0 ? 'is-on' : ''}`}>
              {t('project.changes', { count: git.changes ?? 0, untracked: git.untracked ?? 0 })}
            </span>
          </div>
          <div className="proj__gitactions">
            <span className="muted proj__fetched">
              {git.fetched
                ? t('project.fetched', { time: new Date(git.fetched).toLocaleTimeString() })
                : t('project.notFetched')}
            </span>
            <span className="grow" />
            <Button
              size="sm"
              icon="refresh"
              busy={busy === 'fetch'}
              onClick={async () => {
                setBusy('fetch');
                await load({ fetch: true, force: true });
                setBusy(undefined);
              }}
            >
              {t('project.fetch')}
            </Button>
            <Button
              size="sm"
              icon="download"
              busy={busy === 'pull'}
              disabled={!git.upstream || Boolean(busy)}
              onClick={() => void act('pull')}
            >
              {t('project.pull')}
              {git.behind ? ` ${git.behind}` : ''}
            </Button>
            <Button
              size="sm"
              icon="upload"
              busy={busy === 'push'}
              disabled={!git.upstream || !git.ahead || Boolean(busy)}
              onClick={() => void act('push')}
            >
              {t('project.push')}
              {git.ahead ? ` ${git.ahead}` : ''}
            </Button>
          </div>
          <AnimatePresence>
            {result && (
              <motion.pre
                className={`proj__out l-mono ${result.ok ? '' : 'is-bad'}`}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {result.text}
              </motion.pre>
            )}
          </AnimatePresence>
          {(git.commits?.length ?? 0) > 0 && (
            <ul className="proj__commits" aria-label={t('project.commits')}>
              {git.commits?.map((c) => (
                <li key={c.hash}>
                  <span className="l-mono muted">{c.hash}</span>
                  <span className="grow proj__subject">{c.subject}</span>
                  <span className="muted">{c.author}</span>
                  <span className="l-mono muted">{c.date}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

type Draft = { leftOff: string; milestones: { text: string; done: boolean }[]; next: string[] };

function StatusPage({ project, readOnly }: { project: Project; readOnly: boolean }) {
  const { t } = useTranslation();
  const saveStatus = useApp((s) => s.saveStatus);
  const stored: Draft = useMemo(
    () => ({ leftOff: project.status.leftOff, milestones: project.status.milestones, next: project.status.next }),
    [project.status],
  );
  const [draft, setDraft] = useState<Draft>(stored);
  useEffect(() => setDraft(stored), [stored]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);
  const done = draft.milestones.filter((m) => m.done).length;

  return (
    <section className="proj__page" aria-label={t('project.status')}>
      <div className="mem__head">
        <h3 className="mem__group grow">{t('project.status')}</h3>
        {project.status.updated > 0 && (
          <span className="muted proj__by">
            {t('project.updatedBy', {
              name: project.status.by ?? '—',
              time: new Date(project.status.updated).toLocaleString(),
            })}
          </span>
        )}
      </div>
      <div className="mem__section">
        <label className="mem__head" htmlFor="proj-left">
          <b>{t('project.leftOff')}</b>
          <span className="grow" />
          <span className={`mem__count l-mono ${draft.leftOff.length > 4000 ? 'is-over' : ''}`}>
            {draft.leftOff.length} / 4000
          </span>
        </label>
        <textarea
          id="proj-left"
          className="l-input mem__text"
          value={draft.leftOff}
          readOnly={readOnly}
          placeholder={t('project.leftOffPlaceholder')}
          onChange={(e) => setDraft({ ...draft, leftOff: e.target.value })}
        />
      </div>

      <div className="mem__section">
        <div className="mem__head">
          <b>{t('project.milestones')}</b>
          <span className="muted l-mono">
            {done} / {draft.milestones.length}
          </span>
        </div>
        <ul className="proj__rows">
          {draft.milestones.map((m, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity besides their place
            <li key={i} className="proj__row">
              <input
                type="checkbox"
                checked={m.done}
                disabled={readOnly}
                aria-label={t('project.milestoneDone', { text: m.text })}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    milestones: draft.milestones.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)),
                  })
                }
              />
              <input
                className={`l-input grow ${m.done ? 'is-done' : ''}`}
                value={m.text}
                readOnly={readOnly}
                maxLength={300}
                aria-label={t('project.milestone')}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    milestones: draft.milestones.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                  })
                }
              />
              {!readOnly && (
                <IconButton
                  size="sm"
                  icon="close"
                  label={t('project.removeRow')}
                  onClick={() => setDraft({ ...draft, milestones: draft.milestones.filter((_, j) => j !== i) })}
                />
              )}
            </li>
          ))}
        </ul>
        {!readOnly && (
          <Button
            size="sm"
            variant="quiet"
            icon="plus"
            onClick={() => setDraft({ ...draft, milestones: [...draft.milestones, { text: '', done: false }] })}
          >
            {t('project.addMilestone')}
          </Button>
        )}
      </div>

      <div className="mem__section">
        <div className="mem__head">
          <b>{t('project.next')}</b>
        </div>
        <ol className="proj__rows">
          {draft.next.map((n, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity besides their place
            <li key={i} className="proj__row">
              <span className="l-mono muted proj__num">{i + 1}.</span>
              <input
                className="l-input grow"
                value={n}
                readOnly={readOnly}
                maxLength={300}
                aria-label={t('project.nextStep', { n: i + 1 })}
                onChange={(e) => setDraft({ ...draft, next: draft.next.map((x, j) => (j === i ? e.target.value : x)) })}
              />
              {!readOnly && (
                <>
                  <IconButton
                    size="sm"
                    icon="chevronDown"
                    label={t('project.moveDown')}
                    disabled={i === draft.next.length - 1}
                    onClick={() => {
                      const next = [...draft.next];
                      [next[i], next[i + 1]] = [next[i + 1] ?? '', next[i] ?? ''];
                      setDraft({ ...draft, next });
                    }}
                  />
                  <IconButton
                    size="sm"
                    icon="close"
                    label={t('project.removeRow')}
                    onClick={() => setDraft({ ...draft, next: draft.next.filter((_, j) => j !== i) })}
                  />
                </>
              )}
            </li>
          ))}
        </ol>
        {!readOnly && (
          <Button
            size="sm"
            variant="quiet"
            icon="plus"
            onClick={() => setDraft({ ...draft, next: [...draft.next, ''] })}
          >
            {t('project.addNext')}
          </Button>
        )}
      </div>

      {!readOnly && dirty && (
        <div className="mem__actions">
          <Button size="sm" variant="quiet" onClick={() => setDraft(stored)}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={draft.leftOff.length > 4000}
            onClick={() =>
              void saveStatus({
                id: project.id,
                leftOff: draft.leftOff,
                milestones: draft.milestones.filter((m) => m.text.trim()),
                next: draft.next.filter((n) => n.trim()),
              })
            }
          >
            {t('project.save')}
          </Button>
        </div>
      )}
    </section>
  );
}

function Areas({ project }: { project: Project }) {
  const { t } = useTranslation();
  const workspace = useApp((s) => s.workspace);
  const nameOf = (device?: string) => {
    if (!device) return t('project.shared');
    if (device === workspace?.me.id) return workspace.me.name;
    return workspace?.members?.find((m) => m.device === device)?.name ?? '—';
  };
  return (
    <section className="proj__areas" aria-label={t('project.areas')}>
      <div className="mem__head">
        <h3 className="mem__group grow">{t('project.areas')}</h3>
      </div>
      <p className="muted mem__hint">{t('project.areasHint')}</p>
      {project.areas.length === 0 ? (
        <p className="muted">{t('project.noAreas')}</p>
      ) : (
        <ul className="proj__arealist">
          {project.areas.map((a) => (
            <li key={`${a.path}-${a.member ?? ''}`} className="l-card">
              <span className="l-mono">{a.path}</span>
              <b>{nameOf(a.member)}</b>
              <span className="muted grow">{a.note}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ProjectPage() {
  const { t } = useTranslation();
  const projects = useApp((s) => s.projects) ?? NO_PROJECTS;
  const projectId = useApp((s) => s.projectId);
  const workspace = useApp((s) => s.workspace);
  const openProjectDialog = useApp((s) => s.openProjectDialog);
  const project = projects.find((p) => p.id === projectId);
  const viewer = workspace?.kind === 'team' && workspace.role !== 'editor' && workspace.role !== 'admin';
  if (!project) return null;
  return (
    <main className="chat">
      <header className="chat__head">
        <h2>
          <Icon name="folder" size={15} />
          {project.name}
        </h2>
        {project.description && <span className="chat__topic">{project.description}</span>}
        <span className="grow" />
        <IconButton icon="pencil" label={t('project.edit')} onClick={() => openProjectDialog(project)} />
      </header>
      <motion.div
        key={project.id}
        className="feed mem proj"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0, transition: { type: 'spring', stiffness: 420, damping: 34 } }}
      >
        <GitPanel project={project} />
        <StatusPage project={project} readOnly={viewer} />
        <Areas project={project} />
      </motion.div>
    </main>
  );
}
