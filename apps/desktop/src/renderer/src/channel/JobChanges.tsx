// What a job changed in its agent's folder (PLAN.md 5.3): the files with their counts of lines, each one's diff, and
// taking a file or the whole job back. The diff and the undo happen on the computer that ran the job, so another
// member's job shows the list only.
import type { Job, JobFileChange } from '@lonca/protocol';
import { Button, Chip, Icon, IconButton } from '@lonca/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { core, RpcError } from '../rpc';
import { useApp } from '../store';

type Diff = { patch: string; truncated?: true } | 'loading';

function DiffLines({ patch }: { patch: string }) {
  const lines = patch.replace(/\n$/, '').split('\n');
  return (
    <pre className="jobdiff l-mono">
      {lines.map((line, i) => {
        const kind = line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : '';
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: the lines of a diff have no identity but their place
          <span key={i} className={kind ? `jobdiff__line jobdiff__line--${kind}` : 'jobdiff__line'}>
            {line || ' '}
          </span>
        );
      })}
    </pre>
  );
}

function FileRow({ job, file, mine, undo: canUndo }: { job: Job; file: JobFileChange; mine: boolean; undo: boolean }) {
  const { t } = useTranslation();
  const flash = useApp((s) => s.flash);
  const [diff, setDiff] = useState<Diff>();
  const fail = (e: unknown) => flash(t(`errors.${e instanceof RpcError ? e.code : 'internal'}`, t('errors.internal')));
  const toggle = async () => {
    if (diff) return setDiff(undefined);
    setDiff('loading');
    try {
      setDiff(await core.call('jobs.diff', { id: job.id, path: file.path }));
    } catch (e) {
      setDiff(undefined);
      fail(e);
    }
  };
  const undo = async () => {
    try {
      const r = await core.call('jobs.undo', { id: job.id, paths: [file.path] });
      flash(
        r.undone.length > 0
          ? t('job.changes.undone', { count: r.undone.length })
          : t('job.changes.skipped', { count: r.skipped.length }),
      );
    } catch (e) {
      fail(e);
    }
  };
  const at = file.path.lastIndexOf('/');
  const name = (
    <>
      {at >= 0 && <span className="jobfile__dir">{file.path.slice(0, at + 1)}</span>}
      <span>{file.path.slice(at + 1)}</span>
    </>
  );
  return (
    <li className={`jobfile ${file.undone ? 'is-undone' : ''}`}>
      <div className="jobfile__row">
        <span className={`jobfile__status jobfile__status--${file.status}`}>
          {t(`job.changes.status.${file.status}`)}
        </span>
        {mine && !file.binary ? (
          <button
            type="button"
            className="jobfile__path l-mono"
            aria-expanded={diff !== undefined}
            aria-label={t('job.changes.diffOf', { path: file.path })}
            onClick={toggle}
          >
            {name}
          </button>
        ) : (
          <span className="jobfile__path l-mono">{name}</span>
        )}
        {file.undone && <Chip>{t('job.changes.undoneChip')}</Chip>}
        <span className="grow" />
        {file.binary ? (
          <span className="jobfile__count l-mono">{t('job.changes.binary')}</span>
        ) : (
          <span className="jobfile__count l-mono">
            <span className="jobfile__add">+{file.added}</span> <span className="jobfile__del">−{file.removed}</span>
          </span>
        )}
        {mine && canUndo && !file.undone && (
          <IconButton size="sm" icon="undo" label={`${t('job.changes.undo')} · ${file.path}`} onClick={undo} />
        )}
      </div>
      <AnimatePresence initial={false}>
        {diff && diff !== 'loading' && (
          <motion.div
            className="jobfile__diff"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.16 }}
          >
            {diff.patch ? <DiffLines patch={diff.patch} /> : <p className="muted">{t('job.changes.noDiff')}</p>}
            {diff.truncated && <p className="muted">{t('job.changes.truncated')}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

/** `undo` off: the diff only (a race's contestant, whose folder is a worktree that goes away). */
export function JobChanges({ job, mine, undo = true }: { job: Job; mine: boolean; undo?: boolean }) {
  const { t } = useTranslation();
  const flash = useApp((s) => s.flash);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const changes = job.changes;
  if (!changes || changes.files.length === 0) return null;
  const added = changes.files.reduce((n, f) => n + f.added, 0);
  const removed = changes.files.reduce((n, f) => n + f.removed, 0);
  const count = changes.files.length + (changes.more ?? 0);
  const left = changes.files.filter((f) => !f.undone).length;
  const undoAll = async () => {
    setBusy(true);
    try {
      const r = await core.call('jobs.undo', { id: job.id });
      const said = [
        r.undone.length > 0 ? t('job.changes.undone', { count: r.undone.length }) : '',
        r.skipped.length > 0 ? t('job.changes.skipped', { count: r.skipped.length }) : '',
      ].filter(Boolean);
      flash(said.join(' '));
    } catch (e) {
      flash(t(`errors.${e instanceof RpcError ? e.code : 'internal'}`, t('errors.internal')));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  return (
    <section className="job__changes" aria-label={t('job.changes.title')}>
      <div className="job__changes-head">
        <button type="button" className="job__changes-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />
          <b>{t('job.changes.title')}</b>
          <span>{t('job.changes.files', { count })}</span>
          <span className="l-mono">
            <span className="jobfile__add">+{added}</span> <span className="jobfile__del">−{removed}</span>
          </span>
        </button>
        <span className="grow" />
        {mine &&
          undo &&
          left > 0 &&
          (confirming ? (
            <>
              <span className="muted">{t('job.changes.undoConfirm')}</span>
              <Button size="sm" variant="danger" busy={busy} onClick={undoAll}>
                {t('job.changes.undoAll')}
              </Button>
              <Button size="sm" variant="quiet" onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="quiet" icon="undo" onClick={() => setConfirming(true)}>
              {t('job.changes.undoAll')}
            </Button>
          ))}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            className="job__files"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.16 }}
          >
            {changes.files.map((f) => (
              <FileRow key={f.path} job={job} file={f} mine={mine} undo={undo} />
            ))}
            {changes.more ? (
              <li className="jobfile jobfile--more">{t('job.changes.more', { count: changes.more })}</li>
            ) : null}
          </motion.ul>
        )}
      </AnimatePresence>
    </section>
  );
}
