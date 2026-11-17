// Fields the agent and specialist forms share: the folder (optional, with this computer's default), the character
// presets, the login to move to when the agent's own one is out of quota, and the model from the CLI's own list.
import { AGENT_TRAITS, type CliAccount, type CliKind, type CliModels, TRAITS_MAX, toggleTrait } from '@lonca/protocol';
import { Button, Chip, Icon, IconButton } from '@lonca/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { core } from '../rpc';
import { useApp } from '../store';

/** The select's value for "type a name" (model ids never start with a space). */
const OTHER_MODEL = ' other';

/**
 * The model an agent runs on: the CLI's default, one of the models the CLI lists for the agent's login (read from the
 * CLI, no tokens), or a name typed by hand when the list lacks it or the CLI cannot give one.
 */
export function ModelField({
  id,
  kind,
  account,
  value,
  onChange,
}: {
  id: string;
  kind: CliKind;
  /** The agent's own login ('' for the default one). */
  account: string;
  value: string;
  onChange: (model: string) => void;
}) {
  const { t } = useTranslation();
  const [list, setList] = useState<CliModels>();
  const [typing, setTyping] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    setList(undefined);
    void core
      .call('clis.models', { kind, ...(account ? { account } : {}), ...(round > 0 ? { refresh: true } : {}) })
      .catch((): CliModels => ({ models: [] }))
      .then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, [kind, account, round]);

  const models = list?.models ?? [];
  const known = models.some((m) => m.id === value);
  // Before the list arrives a saved name stays in the select; once it is in, a name the list lacks is typed.
  const custom = typing || (list !== undefined && value !== '' && !known);
  const options = list === undefined && value ? [{ id: value, name: value }] : models;
  const hint =
    list === undefined
      ? t('agentForm.modelLoading')
      : models.length === 0
        ? t('agentForm.modelNoList')
        : custom
          ? t('agentForm.modelTyped')
          : t('agentForm.modelHint');
  return (
    <div className="l-field">
      <label className="l-field__label" htmlFor={id}>
        {t('agentForm.model')}
      </label>
      <div className="modelpick">
        <select
          id={id}
          className="l-input"
          value={custom ? OTHER_MODEL : value}
          aria-describedby={`${id}-note`}
          onChange={(e) => {
            if (e.target.value === OTHER_MODEL) {
              setTyping(true);
              return;
            }
            setTyping(false);
            onChange(e.target.value);
          }}
        >
          <option value="">
            {list?.defaultName
              ? t('agentForm.modelDefaultNamed', { name: list.defaultName })
              : t('agentForm.modelDefault')}
          </option>
          {options.map((m) => (
            <option key={m.id} value={m.id} title={'description' in m ? m.description : undefined}>
              {m.name === m.id ? m.id : `${m.name} · ${m.id}`}
            </option>
          ))}
          <option value={OTHER_MODEL}>{t('agentForm.modelOther')}</option>
        </select>
        <IconButton
          icon="refresh"
          label={t('agentForm.modelRefresh')}
          disabled={list === undefined}
          onClick={() => setRound((r) => r + 1)}
        />
      </div>
      {custom && (
        <input
          className="l-input"
          aria-label={t('agentForm.modelName')}
          value={value}
          maxLength={80}
          placeholder={kind === 'codex' ? 'gpt-6-sol' : 'claude-opus-5-5'}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <span id={`${id}-note`} className="l-field__hint">
        {hint}
      </span>
    </div>
  );
}

/** The select's value for "no spare" (account ids are longer, and '' is the default login). */
const NO_SPARE = '-';

/**
 * The login an agent's jobs move to while its own one is out of quota: none, the default login (for an agent on an
 * extra account), or another extra account of the same CLI. Shown only when there is another login to pick.
 */
export function SpareField({
  id,
  account,
  accounts,
  value,
  onChange,
}: {
  id: string;
  /** The agent's own login ('' for the default one). */
  account: string;
  /** This computer's extra logins of the agent's CLI. */
  accounts: CliAccount[];
  value: string | undefined;
  onChange: (spare: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const options = [
    ...(account ? [{ value: '', label: t('accounts.default') }] : []),
    ...accounts.filter((a) => a.id !== account).map((a) => ({ value: a.id, label: a.name })),
  ];
  if (options.length === 0) return null;
  const shown = value !== undefined && options.some((o) => o.value === value) ? value : NO_SPARE;
  return (
    <div className="l-field">
      <label className="l-field__label" htmlFor={id}>
        {t('accounts.spareField')}
      </label>
      <select
        id={id}
        className="l-input"
        value={shown}
        onChange={(e) => onChange(e.target.value === NO_SPARE ? undefined : e.target.value)}
      >
        <option value={NO_SPARE}>{t('accounts.noSpare')}</option>
        {options.map((o) => (
          <option key={o.value || 'default'} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="l-field__hint">{t('accounts.spareHint')}</span>
    </div>
  );
}

/** What a form sends for its spare: only one that is still a valid pick for the agent's own login. */
export function spareOf(spare: string | undefined, account: string, accounts: CliAccount[]): { spare?: string } {
  if (spare === undefined || spare === account) return {};
  if (spare === '') return account ? { spare } : {};
  return accounts.some((a) => a.id === spare) ? { spare } : {};
}

/** The folder an agent works in. Empty means the default one, which is shown so nothing has to be picked. */
export function FolderField({ value, onChange }: { value: string; onChange: (folder: string) => void }) {
  const { t } = useTranslation();
  const fallback = useApp((s) => s.system?.agentFolder);
  return (
    <div className="l-field">
      <span className="l-field__label">{t('agentForm.folder')}</span>
      <div className="folder__path l-card">
        <Icon name="folder" />
        <span className="l-mono">{value || fallback || '—'}</span>
        {!value && <Chip>{t('agentForm.folderDefault')}</Chip>}
        {value && (
          <Button size="sm" variant="quiet" onClick={() => onChange('')}>
            {t('common.useDefault')}
          </Button>
        )}
        <Button
          size="sm"
          onClick={async () => {
            const dir = await window.lonca.shell.pickFolder();
            if (dir) onChange(dir);
          }}
        >
          {t('agentForm.pick')}
        </Button>
      </div>
      <span className="l-field__hint">{t('agentForm.folderHint')}</span>
    </div>
  );
}

/**
 * Character presets as chips: a click picks or drops one, and picking one drops its opposite. Under the chips,
 * what the picked ones (or the one under the pointer) say.
 */
export function TraitPicker({ value, onChange }: { value: string[]; onChange: (traits: string[]) => void }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<string>();
  const full = value.length >= TRAITS_MAX;
  const shown = hover ? [hover] : value;
  return (
    <fieldset className="l-field traits">
      <legend className="l-field__label traits__legend">
        <span className="grow">{t('traits.title')}</span>
        {value.length > 0 && (
          <span className="l-mono traits__count">{t('traits.count', { count: value.length, max: TRAITS_MAX })}</span>
        )}
      </legend>
      <div className="traits__chips">
        {AGENT_TRAITS.map((trait) => {
          const on = value.includes(trait.id);
          return (
            <button
              key={trait.id}
              type="button"
              className={`trait ${on ? 'is-on' : ''}`}
              aria-pressed={on}
              disabled={!on && full}
              onMouseEnter={() => setHover(trait.id)}
              onMouseLeave={() => setHover(undefined)}
              onFocus={() => setHover(trait.id)}
              onBlur={() => setHover(undefined)}
              onClick={() => onChange(toggleTrait(value, trait.id))}
            >
              <Icon name={trait.icon} size={13} />
              {t(`traits.${trait.id}.name`)}
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? (
        <span className="l-field__hint">{t('traits.hint')}</span>
      ) : (
        <ul className="traits__lines">
          {shown.map((id) => (
            <li key={id}>
              <b>{t(`traits.${id}.name`)}</b>
              <span>{t(`traits.${id}.hint`)}</span>
            </li>
          ))}
        </ul>
      )}
      {full && !hover && <span className="l-field__hint">{t('traits.full', { max: TRAITS_MAX })}</span>}
    </fieldset>
  );
}
