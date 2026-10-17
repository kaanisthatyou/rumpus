// Settings → Providers: model providers for advisors, memory and voice, with their keys (PLAN.md 6.7).
import {
  PROVIDER_PRESETS,
  type ProviderInfo,
  type ProviderPreset,
  type ProviderWire,
  presetOf,
  providerUrlAllowed,
} from '@lonca/protocol';
import { Button, Chip, Icon, IconButton, Segmented, TextField } from '@lonca/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../store';

const presetName = (p: ProviderPreset | undefined, t: (k: string) => string) =>
  p?.id === 'custom' ? t('providers.custom') : (p?.name ?? '');

function PresetGrid({ onPick, onCancel }: { onPick: (p: ProviderPreset) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="stack">
      <h4 className="prov__sub">{t('providers.pick')}</h4>
      <div className="prov__grid">
        {(PROVIDER_PRESETS as readonly ProviderPreset[]).map((p) => (
          <button key={p.id} type="button" className="prov__preset" onClick={() => onPick(p)}>
            <b>{presetName(p, t)}</b>
            <span className="muted">{p.needsKey ? t('providers.cloud') : t('providers.local')}</span>
          </button>
        ))}
      </div>
      <div>
        <Button variant="quiet" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}

function ProviderForm({
  preset,
  existing,
  onDone,
}: {
  preset: ProviderPreset;
  existing?: ProviderInfo;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const saveProvider = useApp((s) => s.saveProvider);
  const fetchModels = useApp((s) => s.fetchModels);
  const protection = useApp((s) => s.providers?.protection ?? 'none');
  const [name, setName] = useState(existing?.name ?? presetName(preset, t));
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? preset.baseUrl);
  const [wire, setWire] = useState<ProviderWire>(existing?.wire ?? preset.wire);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const urlBad = baseUrl.trim() !== '' && !providerUrlAllowed(baseUrl.trim());
  const save = async () => {
    setBusy(true);
    const saved = await saveProvider({
      ...(existing ? { id: existing.id } : {}),
      preset: preset.id,
      name,
      baseUrl,
      wire,
      ...(key.trim() ? { addKey: key.trim() } : {}),
    });
    // A new provider, or a new key: read the model list at once (it costs no tokens).
    if (saved && (!existing || key.trim() || saved.models.length === 0)) await fetchModels(saved.id);
    setBusy(false);
    if (saved) onDone();
  };
  return (
    <form
      className="stack prov__form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h4 className="prov__sub">{presetName(preset, t)}</h4>
      <TextField label={t('providers.name')} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      <TextField
        label={t('providers.baseUrl')}
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        spellCheck={false}
        className="prov__url-field"
        {...(urlBad ? { error: t('errors.provider_bad_url') } : { hint: t('providers.baseUrlHint') })}
      />
      {preset.id === 'custom' && (
        <div className="row-field">
          <span className="row-field__label">{t('providers.wire')}</span>
          <Segmented
            label={t('providers.wire')}
            layoutId="prov-wire"
            value={wire}
            onChange={setWire}
            options={[
              { value: 'openai', label: 'OpenAI' },
              { value: 'anthropic', label: 'Anthropic' },
            ]}
          />
        </div>
      )}
      <TextField
        label={existing?.keys.length ? t('providers.keyAdd') : t('providers.key')}
        type="password"
        autoComplete="off"
        value={key}
        disabled={protection === 'none'}
        onChange={(e) => setKey(e.target.value)}
        hint={preset.needsKey ? t('providers.keyHint') : t('providers.keyOptional')}
      />
      <div className="prov__actions">
        <Button type="submit" variant="primary" busy={busy} disabled={!name.trim() || !baseUrl.trim() || urlBad}>
          {t('providers.save')}
        </Button>
        <Button variant="quiet" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <span className="grow" />
        {preset.keyUrl && (
          <Button
            variant="quiet"
            icon="external"
            onClick={() => preset.keyUrl && void window.lonca.shell.openExternal(preset.keyUrl)}
          >
            {t('providers.getKey')}
          </Button>
        )}
      </div>
    </form>
  );
}

function ProviderRow({ p, onEdit }: { p: ProviderInfo; onEdit: () => void }) {
  const { t } = useTranslation();
  const removeProvider = useApp((s) => s.removeProvider);
  const removeKey = useApp((s) => s.removeProviderKey);
  const fetchModels = useApp((s) => s.fetchModels);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const preset = presetOf(p.preset);
  return (
    <motion.li layout className="prov l-card" aria-label={p.name}>
      <div className="prov__head">
        <b>{p.name}</b>
        {p.name !== presetName(preset, t) && <Chip>{presetName(preset, t)}</Chip>}
        {p.wire === 'anthropic' && preset?.id === 'custom' && <Chip>Anthropic</Chip>}
        <span className="grow" />
        {confirming ? (
          <>
            <span className="muted">{t('providers.deleteConfirm')}</span>
            <Button size="sm" variant="danger" onClick={() => void removeProvider(p.id)}>
              {t('providers.delete')}
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <>
            <IconButton size="sm" icon="pencil" label={t('providers.edit')} onClick={onEdit} />
            <IconButton size="sm" icon="trash" label={t('providers.delete')} onClick={() => setConfirming(true)} />
          </>
        )}
      </div>
      <code className="prov__url l-mono">{p.baseUrl}</code>
      <div className="prov__keys">
        {p.keys.length === 0 ? (
          <span className="muted">{preset?.needsKey ? t('providers.noKey') : t('providers.noKeyLocal')}</span>
        ) : (
          p.keys.map((k, i) => (
            <span key={k.id} className="keychip">
              <Icon name="key" size={12} />
              <span className="l-mono">
                {i + 1}. ···{k.hint}
              </span>
              <button
                type="button"
                className="keychip__x"
                aria-label={t('providers.removeKey', { hint: k.hint })}
                onClick={() => void removeKey(p.id, k.id)}
              >
                <Icon name="close" size={11} />
              </button>
            </span>
          ))
        )}
      </div>
      <div className="prov__models">
        <span className="muted" title={p.models.slice(0, 40).join('\n')}>
          {p.modelsAt ? t('providers.models', { count: p.models.length }) : t('providers.noModels')}
        </span>
        <span className="grow" />
        <Button
          size="sm"
          icon="refresh"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            await fetchModels(p.id);
            setBusy(false);
          }}
        >
          {t('providers.fetch')}
        </Button>
      </div>
    </motion.li>
  );
}

export function ProvidersPanel() {
  const { t } = useTranslation();
  const state = useApp((s) => s.providers);
  const [mode, setMode] = useState<{ kind: 'pick' } | { kind: 'form'; preset: ProviderPreset; id?: string }>();
  const list = state?.providers ?? [];
  const protection = state?.protection ?? 'none';
  const editing = mode?.kind === 'form' && mode.id ? list.find((p) => p.id === mode.id) : undefined;
  return (
    <div className="stack">
      <p className="muted">{t('providers.intro')}</p>
      <p className={`prov__protect prov__protect--${protection}`}>
        <Icon name={protection === 'os' ? 'key' : 'alert'} size={14} />
        <span>{t(`providers.protection.${protection}`)}</span>
      </p>
      {mode?.kind === 'pick' ? (
        <PresetGrid onPick={(preset) => setMode({ kind: 'form', preset })} onCancel={() => setMode(undefined)} />
      ) : mode?.kind === 'form' ? (
        <ProviderForm
          preset={mode.preset}
          {...(editing ? { existing: editing } : {})}
          onDone={() => setMode(undefined)}
        />
      ) : (
        <>
          {list.length === 0 && <p className="muted">{t('providers.empty')}</p>}
          <ul className="prov__list">
            <AnimatePresence initial={false}>
              {list.map((p) => (
                <ProviderRow
                  key={p.id}
                  p={p}
                  onEdit={() => {
                    const preset = presetOf(p.preset);
                    if (preset) setMode({ kind: 'form', preset, id: p.id });
                  }}
                />
              ))}
            </AnimatePresence>
          </ul>
          <div>
            <Button icon="plus" onClick={() => setMode({ kind: 'pick' })}>
              {t('providers.add')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
