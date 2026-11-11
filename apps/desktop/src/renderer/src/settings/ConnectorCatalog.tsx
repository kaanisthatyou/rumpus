// Settings → Connectors → Add: Serai's catalog (registry entries Serai checked) above a live search of the
// official MCP Registry (community entries, not reviewed), and the install form both lead to (PLAN.md 5.9).
import {
  CATALOG,
  type CatalogEntry,
  type ConnectorInfo,
  type ConnectorsState,
  catalogPlans,
  connectorFromPlan,
  type InstallPlan,
  installPlans,
  missingFields,
  type RegistryServer,
} from '@lonca/protocol';
import { Button, Chip, Icon, Segmented, Spinner, TextField } from '@lonca/ui';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { core, RpcError } from '../rpc';
import { useApp } from '../store';
import { AgentChecks } from './AgentChecks';

type Runtimes = { npx: boolean; uvx: boolean; docker: boolean };
type Picked = { server: RegistryServer; entry?: CatalogEntry };

const fold = (s: string) => s.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');

/** A short name for an entry without a title: the last part of its registry name. */
const shortName = (s: RegistryServer) => s.title ?? s.name.split('/').pop() ?? s.name;

function InstallForm({
  picked,
  protection,
  onBack,
  onDone,
}: {
  picked: Picked;
  protection: ConnectorsState['protection'];
  onBack: () => void;
  onDone: (state: ConnectorsState) => void;
}) {
  const { t, i18n } = useTranslation();
  const flash = useApp((s) => s.flash);
  const { server, entry } = picked;
  const plans = useMemo(() => (entry ? catalogPlans(entry) : installPlans(server)), [server, entry]);
  const [planId, setPlanId] = useState(plans[0]?.id ?? '');
  const plan = plans.find((p) => p.id === planId) ?? plans[0];
  const [name, setName] = useState(entry?.name ?? shortName(server));
  const [values, setValues] = useState<Record<string, string>>({ ...entry?.defaults });
  const [agents, setAgents] = useState<string[]>([]);
  const [runtimes, setRuntimes] = useState<Runtimes>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void core.call('connectors.runtimes').then(setRuntimes);
  }, []);
  const missing = plan ? missingFields(plan, values) : [];
  const noRuntime = plan?.runtime && runtimes && !runtimes[plan.runtime];
  const needsSecret = plan?.fields.some((f) => f.secret && (values[f.key] ?? '').trim()) && protection === 'none';
  const preview = plan ? connectorFromPlan(plan, values, { name, agents, source: undefined }) : undefined;
  const open = (url: string) => void window.lonca.shell.openExternal(url);
  const via = (p: InstallPlan) => t(`catalog.via.${p.via}`);

  const install = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const input = connectorFromPlan(plan, values, {
        name: name.trim(),
        agents,
        source: {
          from: entry ? 'catalog' : 'registry',
          name: server.name,
          via: plan.via,
          ...(server.version ? { version: server.version } : {}),
        },
      });
      onDone(await core.call('connectors.save', input));
    } catch (e) {
      flash(t(`errors.${e instanceof RpcError ? e.code : 'internal'}`, t('errors.internal')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="stack prov__form catalog__install"
      onSubmit={(e) => {
        e.preventDefault();
        if (plan && !missing.length && !noRuntime && !needsSecret && name.trim()) void install();
      }}
    >
      <div className="catalog__head">
        <Icon name="plug" size={16} />
        <h4 className="prov__sub">{entry?.name ?? shortName(server)}</h4>
        <Chip>{entry ? t('catalog.verified') : t('catalog.community')}</Chip>
      </div>
      <p className="muted">{entry ? entry.summary[i18n.language === 'tr' ? 'tr' : 'en'] : server.description}</p>
      <p className="catalog__meta">
        <code className="l-mono">
          {server.name}
          {server.version ? ` ${server.version}` : ''}
        </code>
        {server.repository?.url && (
          <Button size="sm" variant="quiet" icon="external" onClick={() => open(server.repository?.url ?? '')}>
            {t('catalog.source')}
          </Button>
        )}
        {server.websiteUrl && (
          <Button size="sm" variant="quiet" icon="globe" onClick={() => open(server.websiteUrl ?? '')}>
            {t('catalog.website')}
          </Button>
        )}
      </p>
      {!entry && (
        <p className="prov__protect prov__protect--weak">
          <Icon name="alert" size={14} />
          <span>{t('catalog.communityNote')}</span>
        </p>
      )}
      {entry?.signIn && (
        <p className="prov__protect prov__protect--os">
          <Icon name="key" size={14} />
          <span>{t('catalog.signInNote')}</span>
        </p>
      )}
      {!plan ? (
        <p className="prov__protect prov__protect--none">
          <Icon name="alert" size={14} />
          <span>{t('catalog.cannot')}</span>
        </p>
      ) : (
        <>
          <TextField
            label={t('connectors.name')}
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
          />
          {plans.length > 1 && (
            <div className="l-field">
              <span className="l-field__label">{t('catalog.how')}</span>
              <Segmented
                label={t('catalog.how')}
                layoutId="catalog-plan"
                value={plan.id}
                onChange={setPlanId}
                options={plans.map((p) => ({ value: p.id, label: via(p) }))}
              />
            </div>
          )}
          {noRuntime && plan.runtime && (
            <p className="prov__protect prov__protect--none" role="status">
              <Icon name="alert" size={14} />
              <span>{t(`catalog.missing.${plan.runtime}`)}</span>
            </p>
          )}
          {plan.fields.map((f) =>
            f.boolean ? (
              <label key={f.key} className="advform__check catalog__flag">
                <input
                  type="checkbox"
                  checked={(values[f.key] ?? f.default) === 'true'}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.checked ? 'true' : 'false' }))}
                />
                <span className="l-mono">{f.label}</span>
                {f.description && <span className="muted">{f.description}</span>}
              </label>
            ) : f.choices ? (
              <div key={f.key} className="l-field">
                <label className="l-field__label" htmlFor={`field-${f.key}`}>
                  {f.label}
                </label>
                <select
                  id={`field-${f.key}`}
                  className="l-input"
                  value={values[f.key] ?? f.default ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                >
                  {!f.required && <option value="">—</option>}
                  {f.choices.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <TextField
                key={f.key}
                label={`${f.label}${f.required ? '' : ` ${t('catalog.optional')}`}`}
                className="prov__url-field"
                type={f.secret ? 'password' : 'text'}
                autoComplete="off"
                spellCheck={false}
                disabled={f.secret && protection === 'none'}
                value={values[f.key] ?? ''}
                placeholder={f.placeholder ?? f.default ?? ''}
                {...(f.description ? { hint: f.description } : {})}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            ),
          )}
          {entry?.keyUrl && plan.fields.some((f) => f.secret) && (
            <div>
              <Button size="sm" variant="quiet" icon="external" onClick={() => open(entry.keyUrl ?? '')}>
                {t('catalog.getKey')}
              </Button>
            </div>
          )}
          {protection === 'none' && plan.fields.some((f) => f.secret) && (
            <p className="muted">{t('connectors.protection.none')}</p>
          )}
          <AgentChecks chosen={agents} onChange={setAgents} />
          {preview && (
            <div className="l-field">
              <span className="l-field__label">{t('catalog.runs')}</span>
              <code className="l-mono catalog__runs">
                {preview.kind === 'remote' ? preview.url : [preview.command, ...(preview.args ?? [])].join(' ')}
              </code>
              {(preview.secrets?.length ?? 0) > 0 && (
                <span className="l-field__hint">
                  {t('catalog.sealed', { names: preview.secrets?.map((s) => s.name).join(', ') })}
                </span>
              )}
            </div>
          )}
        </>
      )}
      <div className="prov__actions">
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={!plan || missing.length > 0 || !!noRuntime || !!needsSecret || !name.trim()}
        >
          {t('catalog.install')}
        </Button>
        <Button variant="quiet" onClick={onBack}>
          {t('catalog.back')}
        </Button>
      </div>
    </form>
  );
}

export function ConnectorCatalog({
  protection,
  installed,
  onDone,
  onManual,
}: {
  protection: ConnectorsState['protection'];
  installed: ConnectorInfo[];
  onDone: (state?: ConnectorsState) => void;
  onManual: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Picked>();
  const [found, setFound] = useState<{ query: string; servers: RegistryServer[]; next?: string }>();
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const lang = i18n.language === 'tr' ? 'tr' : 'en';
  const have = new Set(installed.map((c) => c.source?.name).filter(Boolean));
  const q = fold(query.trim());
  const curated = CATALOG.filter(
    (e) =>
      !q || fold(`${e.name} ${e.summary[lang]} ${e.server.name} ${t(`catalog.category.${e.category}`)}`).includes(q),
  );

  // The registry is asked only for a typed name, a moment after typing stops.
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setFound(undefined);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      setFailed(false);
      try {
        const r = await core.call('connectors.search', { query: text });
        if (live) setFound({ query: text, ...r });
      } catch {
        if (live) setFailed(true);
      } finally {
        if (live) setSearching(false);
      }
    }, 450);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const more = async () => {
    if (!found?.next) return;
    setSearching(true);
    try {
      const r = await core.call('connectors.search', { query: found.query, cursor: found.next });
      setFound({ query: found.query, servers: [...found.servers, ...r.servers], ...(r.next ? { next: r.next } : {}) });
    } catch {
      setFailed(true);
    } finally {
      setSearching(false);
    }
  };

  if (picked)
    return (
      <InstallForm
        picked={picked}
        protection={protection}
        onBack={() => setPicked(undefined)}
        onDone={(s) => onDone(s)}
      />
    );

  const curatedNames = new Set(CATALOG.map((e) => e.server.name));
  const community = (found?.servers ?? []).filter((s) => !curatedNames.has(s.name));
  return (
    <div className="stack">
      <TextField
        label={t('catalog.search')}
        value={query}
        placeholder={t('catalog.searchHint')}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <section className="stack" aria-label={t('catalog.title')}>
        <h4 className="prov__sub">{t('catalog.title')}</h4>
        <p className="muted">{t('catalog.intro')}</p>
        {curated.length === 0 ? (
          <p className="muted">{t('catalog.none')}</p>
        ) : (
          <div className="catalog__grid">
            {curated.map((e) => (
              <button
                key={e.id}
                type="button"
                className="prov__preset catalog__card"
                onClick={() => setPicked({ server: e.server, entry: e })}
              >
                <span className="catalog__card-head">
                  <b>{e.name}</b>
                  {have.has(e.server.name) && <Icon name="check" size={13} label={t('catalog.installed')} />}
                </span>
                <span className="muted">{e.summary[lang]}</span>
                <span className="catalog__cat">{t(`catalog.category.${e.category}`)}</span>
              </button>
            ))}
          </div>
        )}
      </section>
      {query.trim().length >= 2 && (
        <section className="stack" aria-label={t('catalog.registry')}>
          <h4 className="prov__sub">{t('catalog.registry')}</h4>
          <p className="prov__protect prov__protect--weak">
            <Icon name="alert" size={14} />
            <span>{t('catalog.communityNote')}</span>
          </p>
          {failed && <p className="muted">{t('errors.registry_unreachable')}</p>}
          {searching && !found && <Spinner label={t('catalog.searching')} />}
          {found && community.length === 0 && !failed && <p className="muted">{t('catalog.noResults')}</p>}
          <ul className="catalog__results">
            {community.map((s) => {
              const runnable = installPlans(s).length > 0;
              return (
                <li key={s.name}>
                  <button
                    type="button"
                    className="catalog__result"
                    disabled={!runnable}
                    onClick={() => setPicked({ server: s })}
                  >
                    <span className="catalog__card-head">
                      <b>{shortName(s)}</b>
                      {have.has(s.name) && <Icon name="check" size={13} label={t('catalog.installed')} />}
                      <span className="grow" />
                      {!runnable && <span className="muted">{t('catalog.cannotShort')}</span>}
                    </span>
                    <code className="l-mono">{s.name}</code>
                    {s.description && <span className="muted">{s.description}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {found?.next && (
            <div>
              <Button size="sm" busy={searching} onClick={() => void more()}>
                {t('catalog.more')}
              </Button>
            </div>
          )}
        </section>
      )}
      <div className="prov__actions">
        <Button variant="quiet" onClick={() => onDone()}>
          {t('common.cancel')}
        </Button>
        <span className="grow" />
        <Button variant="quiet" onClick={onManual}>
          {t('connectors.manual')}
        </Button>
      </div>
    </div>
  );
}
