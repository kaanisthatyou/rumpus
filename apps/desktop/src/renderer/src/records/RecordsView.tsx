// Records (Kayıtlar): ideas, reference images, saved commands. One list with an editor next to it.
import { IDEA_STATUSES, type IdeaStatus, type RecordItem, type RecordKind } from '@lonca/protocol';
import { Button, Chip, Icon, type IconName, Segmented, TextField } from '@lonca/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clock } from '../channel/format';
import { useApp } from '../store';

const ICON: Record<RecordKind, IconName> = { idea: 'idea', reference: 'image', command: 'bookmark' };
const VIEW: Record<RecordKind, 'ideas' | 'references' | 'commands'> = {
  idea: 'ideas',
  reference: 'references',
  command: 'commands',
};

/** Reads an image file into a data URL with its size. */
export async function readImage(file: Blob): Promise<{ dataUrl: string; width: number; height: number }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const size = await new Promise<{ width: number; height: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
  return { dataUrl, ...size };
}

/** A reference's image, loaded the first time it is shown. */
export function RefImage({ id, className }: { id: string; className?: string }) {
  const url = useApp((s) => s.images[id]);
  const loadImage = useApp((s) => s.loadImage);
  useEffect(() => {
    if (!url) void loadImage(id);
  }, [id, url, loadImage]);
  return url ? (
    <img className={className} src={url} alt="" draggable={false} />
  ) : (
    <span className={`${className ?? ''} is-loading`} />
  );
}

/** Fills a command's variables. */
export function fillCommand(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

function Editor({
  record,
  kind,
  onSaved,
}: {
  record: RecordItem | undefined;
  kind: RecordKind;
  onSaved: (r: RecordItem) => void;
}) {
  const { t, i18n } = useTranslation();
  const saveRecord = useApp((s) => s.saveRecord);
  const deleteRecord = useApp((s) => s.deleteRecord);
  const attach = useApp((s) => s.attach);
  const putInComposer = useApp((s) => s.putInComposer);
  const flash = useApp((s) => s.flash);
  const settings = useApp((s) => s.settings);
  const channel = useApp((s) => s.workspace?.channels.find((c) => c.id === s.channelId));
  const [title, setTitle] = useState(record?.title ?? '');
  const [body, setBody] = useState(record?.body ?? '');
  const [tags, setTags] = useState(record?.tags.join(', ') ?? '');
  const [status, setStatus] = useState<IdeaStatus>(record?.status ?? 'new');

  const save = async () => {
    const saved = await saveRecord({
      ...(record ? { id: record.id } : {}),
      kind,
      title,
      body,
      tags: tags
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      ...(kind === 'idea' ? { status } : {}),
    });
    if (saved) {
      flash(t('records.saved'));
      onSaved(saved);
    }
  };

  return (
    <motion.form
      key={record?.id ?? 'new'}
      className="rec-editor"
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {kind === 'reference' && record && <RefImage id={record.id} className="rec-editor__image" />}
      <TextField
        label={t('records.title')}
        value={title}
        maxLength={200}
        required
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="l-field">
        <label className="l-field__label" htmlFor="rec-body">
          {t(`records.body.${kind}`)}
        </label>
        <textarea
          id="rec-body"
          className="l-input rec-editor__body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        {kind === 'command' && <span className="l-field__hint">{t('records.commandHint')}</span>}
      </div>
      <TextField
        label={t('records.tags')}
        value={tags}
        hint={t('records.tagsHint')}
        onChange={(e) => setTags(e.target.value)}
      />
      {kind === 'idea' && (
        <div className="l-field">
          <span className="l-field__label">{t('records.status')}</span>
          <Segmented
            layoutId="idea-status"
            label={t('records.status')}
            value={status}
            onChange={setStatus}
            options={IDEA_STATUSES.map((s) => ({ value: s, label: t(`records.statuses.${s}`) }))}
          />
        </div>
      )}
      <footer className="rec-editor__foot">
        {record && (
          <Button variant="danger" icon="trash" onClick={() => void deleteRecord(record.id)}>
            {t('records.delete')}
          </Button>
        )}
        <span className="grow" />
        {record && kind !== 'command' && channel && (
          <Button
            icon="plus"
            onClick={() => {
              attach(record.id);
              flash(t('records.attached'));
              useApp.getState().setView('channel');
            }}
          >
            {t('records.attach')}
          </Button>
        )}
        {record && kind === 'command' && channel && (
          <Button
            icon="chevronRight"
            onClick={() =>
              putInComposer(
                fillCommand(record.body || record.title, {
                  user: settings?.profile.name ?? '',
                  channel: channel.name,
                  date: new Date().toLocaleDateString(i18n.language),
                }),
              )
            }
          >
            {t('records.use')}
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={!title.trim()}>
          {t('records.save')}
        </Button>
      </footer>
    </motion.form>
  );
}

export function RecordsView({ kind }: { kind: RecordKind }) {
  const { t } = useTranslation();
  const all = useApp((s) => s.records);
  const saveRecord = useApp((s) => s.saveRecord);
  const [selected, setSelected] = useState<string | 'new' | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [dropping, setDropping] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((r) => r.kind === kind)
      .filter((r) => !q || `${r.title} ${r.body} ${r.tags.join(' ')}`.toLowerCase().includes(q));
  }, [all, kind, query]);
  const record = selected && selected !== 'new' ? all.find((r) => r.id === selected) : undefined;

  const addImages = async (files: Blob[]) => {
    for (const file of files.filter((f) => f.type.startsWith('image/'))) {
      const img = await readImage(file);
      const saved = await saveRecord({
        kind: 'reference',
        title: (file as File).name?.replace(/\.[^.]+$/, '') || `${t('records.pasted')} ${clock(Date.now())}`,
        imageData: img.dataUrl,
        width: img.width,
        height: img.height,
      });
      if (saved) setSelected(saved.id);
    }
  };

  // Pasting an image anywhere in the references view adds it.
  useEffect(() => {
    if (kind !== 'reference') return;
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        void addImages(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  return (
    <main
      className={`chat records ${dropping ? 'is-dropping' : ''}`}
      onDragOver={(e) => {
        if (kind === 'reference' && e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        if (kind !== 'reference') return;
        e.preventDefault();
        setDropping(false);
        void addImages([...e.dataTransfer.files]);
      }}
    >
      <header className="chat__head">
        <h2>
          <Icon name={ICON[kind]} size={15} />
          {t(`shell.${VIEW[kind]}`)}
        </h2>
        {kind === 'reference' && <span className="chat__topic">{t('records.refHint')}</span>}
        <span className="grow" />
        {kind === 'reference' ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              onChange={(e) => {
                void addImages([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
            <Button size="sm" icon="plus" onClick={() => fileRef.current?.click()}>
              {t('records.chooseFile')}
            </Button>
          </>
        ) : (
          <Button size="sm" icon="plus" onClick={() => setSelected('new')}>
            {t(`records.new.${kind}`)}
          </Button>
        )}
      </header>
      <div className="records__body">
        <div className="records__list">
          <div className="records__search">
            <Icon name="search" size={14} />
            <input
              value={query}
              placeholder={t('records.search')}
              aria-label={t('records.search')}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {items.length === 0 && <p className="muted records__empty">{t(`records.empty.${kind}`)}</p>}
          <ul className={kind === 'reference' ? 'records__grid' : 'records__rows'}>
            <AnimatePresence initial={false}>
              {items.map((r) => (
                <motion.li
                  key={r.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <button
                    type="button"
                    className={`rec ${selected === r.id ? 'is-on' : ''}`}
                    onClick={() => setSelected(r.id)}
                  >
                    {kind === 'reference' && <RefImage id={r.id} className="rec__thumb" />}
                    <span className="rec__title">{r.title}</span>
                    <span className="rec__meta">
                      {r.status && <Chip>{t(`records.statuses.${r.status}`)}</Chip>}
                      {r.tags.slice(0, 3).map((tag) => (
                        <Chip key={tag} mono>
                          {tag}
                        </Chip>
                      ))}
                    </span>
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
        <div className="records__editor">
          {selected === 'new' || record ? (
            <Editor key={record?.id ?? 'new'} record={record} kind={kind} onSaved={(r) => setSelected(r.id)} />
          ) : (
            <p className="muted records__select">{t('records.select')}</p>
          )}
        </div>
      </div>
    </main>
  );
}
