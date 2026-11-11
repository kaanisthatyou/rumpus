// Settings → Connectors: MCP servers this computer runs or connects to for its own agents (PLAN.md 5.9), with
// sealed secrets, the agents allowed to use each one, and a policy per tool.
import {
  type ConnectorInfo,
  type ConnectorKind,
  type ConnectorsState,
  connectorUrlAllowed,
  OAUTH_REDIRECT_URI,
  SECRET_NAME,
  TOOL_POLICIES,
  type ToolPolicy,
} from '@lonca/protocol';
import { Button, Chip, Icon, IconButton, Segmented, TextField } from '@lonca/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { core, RpcError } from '../rpc';
import { useApp } from '../store';
import { AgentChecks, useOwnAgents } from './AgentChecks';
import { ConnectorCatalog } from './ConnectorCatalog';

function useConnectors(): [ConnectorsState | undefined, (s: ConnectorsState) => void] {
  const [state, setState] = useState<ConnectorsState>();
  useEffect(() => {
    void core.call('connectors.list').then(setState);
    return core.on('connectors.changed', setState);
  }, []);
  return [state, setState];
}

function ConnectorForm({
  existing,
  protection,
  onDone,
}: {
  existing?: ConnectorInfo;
  protection: ConnectorsState['protection'];
  onDone: (state?: ConnectorsState) => void;
}) {
  const { t } = useTranslation();
  const flash = useApp((s) => s.flash);
  const [name, setName] = useState(existing?.name ?? '');
  const [kind, setKind] = useState<ConnectorKind>(existing?.kind ?? 'remote');
  const [url, setUrl] = useState(existing?.url ?? '');
  const [command, setCommand] = useState(existing?.command ?? '');
  const [args, setArgs] = useState((existing?.args ?? []).join('\n'));
  /** Secrets to set: kept ones show their hint and stay unless given a new value or removed. */
  const [secrets, setSecrets] = useState<{ name: string; value: string; hint?: string; removed?: boolean }[]>(
    existing?.secrets.map((s) => ({ name: s.name, value: '', hint: s.hint })) ?? [],
  );
  const [chosen, setChosen] = useState<string[]>(existing?.agents ?? []);
  const [clientId, setClientId] = useState(existing?.oauth?.clientId ?? '');
  const [busy, setBusy] = useState(false);
  const urlBad = kind === 'remote' && url.trim() !== '' && !connectorUrlAllowed(url.trim());
  const badSecret = secrets.some((s) => s.name.trim() !== '' && !SECRET_NAME.test(s.name.trim()));
  const ready = name.trim() && (kind === 'remote' ? url.trim() && !urlBad : command.trim()) && !badSecret;

  const save = async () => {
    setBusy(true);
    try {
      const state = await core.call('connectors.save', {
        ...(existing ? { id: existing.id } : {}),
        name: name.trim(),
        kind,
        ...(kind === 'remote'
          ? { url: url.trim(), clientId: clientId.trim() }
          : {
              command: command.trim(),
              args: args
                .split('\n')
                .map((a) => a.trim())
                .filter(Boolean),
            }),
        secrets: secrets
          .filter((s) => s.name.trim() && (s.removed || s.value.trim()))
          .map((s) => ({ name: s.name.trim(), value: s.removed ? '' : s.value.trim() })),
        agents: chosen,
      });
      onDone(state);
    } catch (e) {
      flash(t(`errors.${e instanceof RpcError ? e.code : 'internal'}`, t('errors.internal')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="stack prov__form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void save();
      }}
    >
      <h4 className="prov__sub">{existing ? existing.name : t('connectors.new')}</h4>
      <TextField label={t('connectors.name')} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      <div className="l-field">
        <span className="l-field__label">{t('connectors.kind')}</span>
        <Segmented
          label={t('connectors.kind')}
          layoutId="conn-kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'remote', label: t('connectors.kinds.remote'), icon: 'globe' },
            { value: 'local', label: t('connectors.kinds.local'), icon: 'terminal' },
          ]}
        />
        <span className="l-field__hint">{t(`connectors.kindHint.${kind}`)}</span>
      </div>
      {kind === 'remote' ? (
        <TextField
          label={t('connectors.url')}
          value={url}
          spellCheck={false}
          placeholder="https://example.com/mcp"
          className="prov__url-field"
          onChange={(e) => setUrl(e.target.value)}
          {...(urlBad ? { error: t('connectors.urlBad') } : { hint: t('connectors.urlHint') })}
        />
      ) : (
        <>
          <TextField
            label={t('connectors.command')}
            value={command}
            spellCheck={false}
            placeholder="npx"
            className="prov__url-field"
            hint={t('connectors.commandHint')}
            onChange={(e) => setCommand(e.target.value)}
          />
          <div className="l-field">
            <label className="l-field__label" htmlFor="conn-args">
              {t('connectors.args')}
            </label>
            <textarea
              id="conn-args"
              className="l-input l-mono conn__args"
              rows={3}
              spellCheck={false}
              placeholder={'-y\n@modelcontextprotocol/server-filesystem\nC:\\Projeler'}
              value={args}
              onChange={(e) => setArgs(e.target.value)}
            />
            <span className="l-field__hint">{t('connectors.argsHint')}</span>
          </div>
        </>
      )}
      <fieldset className="l-field conn__secrets">
        <legend className="l-field__label">{t(`connectors.secrets.${kind}`)}</legend>
        {secrets.map((s, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity until saved
          <div key={i} className={`conn__secret ${s.removed ? 'is-removed' : ''}`}>
            <input
              className="l-input l-mono"
              aria-label={t('connectors.secretName')}
              placeholder={kind === 'remote' ? 'Authorization' : 'API_TOKEN'}
              value={s.name}
              readOnly={s.hint !== undefined}
              spellCheck={false}
              onChange={(e) => setSecrets((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
            <input
              className="l-input l-mono"
              type="password"
              autoComplete="off"
              aria-label={t('connectors.secretValue')}
              placeholder={s.hint ? `···${s.hint.replace('…', '')}` : kind === 'remote' ? 'Bearer …' : ''}
              value={s.value}
              disabled={s.removed || protection === 'none'}
              onChange={(e) =>
                setSecrets((prev) => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
              }
            />
            <IconButton
              size="sm"
              icon={s.removed ? 'refresh' : 'trash'}
              label={s.removed ? t('connectors.secretKeep') : t('connectors.secretRemove')}
              onClick={() =>
                setSecrets((prev) =>
                  s.hint === undefined
                    ? prev.filter((_, j) => j !== i)
                    : prev.map((x, j) => (j === i ? { ...x, removed: !x.removed, value: '' } : x)),
                )
              }
            />
          </div>
        ))}
        <div>
          <Button
            size="sm"
            icon="plus"
            disabled={protection === 'none'}
            onClick={() =>
              setSecrets((prev) => [
                ...prev,
                { name: kind === 'remote' && prev.length === 0 ? 'Authorization' : '', value: '' },
              ])
            }
          >
            {t('connectors.secretAdd')}
          </Button>
        </div>
        <span className="l-field__hint">
          {protection === 'none' ? t('connectors.protection.none') : t(`connectors.secretsHint.${kind}`)}
        </span>
      </fieldset>
      {kind === 'remote' && (
        <TextField
          label={t('connectors.oauth.clientId')}
          value={clientId}
          maxLength={200}
          spellCheck={false}
          className="prov__url-field"
          hint={t('connectors.oauth.clientIdHint', { uri: OAUTH_REDIRECT_URI })}
          onChange={(e) => setClientId(e.target.value)}
        />
      )}
      <AgentChecks chosen={chosen} onChange={setChosen} />
      <div className="prov__actions">
        <Button type="submit" variant="primary" busy={busy} disabled={!ready}>
          {t('connectors.save')}
        </Button>
        <Button variant="quiet" onClick={() => onDone()}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

function ToolRow({
  c,
  tool,
  onState,
}: {
  c: ConnectorInfo;
  tool: ConnectorInfo['tools'][number];
  onState: (s: ConnectorsState) => void;
}) {
  const { t } = useTranslation();
  const id = `tool-${c.id}-${tool.name}`;
  return (
    <li className="conn__tool">
      <div className="conn__tool-text">
        <label htmlFor={id} className="l-mono">
          {tool.name}
        </label>
        {tool.readOnly && <Chip>{t('connectors.readOnly')}</Chip>}
        {tool.description && <span className="muted conn__tool-desc">{tool.description}</span>}
      </div>
      <select
        id={id}
        className="l-input conn__policy"
        value={tool.policy}
        onChange={async (e) =>
          onState(
            await core.call('connectors.policy', { id: c.id, tool: tool.name, policy: e.target.value as ToolPolicy }),
          )
        }
      >
        {TOOL_POLICIES.map((p) => (
          <option key={p} value={p}>
            {t(`connectors.policy.${p}`)}
          </option>
        ))}
      </select>
    </li>
  );
}

/** A remote connector's sign-in in the browser: asked for, waited for, or done. */
function SignInRow({ c, onState }: { c: ConnectorInfo; onState: (s: ConnectorsState) => void }) {
  const { t } = useTranslation();
  const flash = useApp((s) => s.flash);
  const [busy, setBusy] = useState(false);
  /** The address of the sign-in being waited for, to copy when the browser did not open. */
  const [link, setLink] = useState<string>();
  const oauth = c.oauth;
  if (!oauth) return null;
  const fail = (e: unknown) => flash(t(`errors.${e instanceof RpcError ? e.code : 'internal'}`, t('errors.internal')));
  const signIn = async () => {
    setBusy(true);
    try {
      const { url, state } = await core.call('connectors.signIn', { id: c.id });
      setLink(url);
      onState(state);
      void window.lonca.shell.openExternal(url);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  if (oauth.state === 'signed_in')
    return (
      <div className="conn__signin">
        <span className="keychip">
          <Icon name="key" size={12} />
          <span>{t('connectors.oauth.signedIn', { issuer: hostOf(oauth.issuer) })}</span>
        </span>
        <span className="grow" />
        <Button
          size="sm"
          variant="quiet"
          onClick={async () => {
            try {
              onState(await core.call('connectors.signOut', { id: c.id }));
            } catch (e) {
              fail(e);
            }
          }}
        >
          {t('connectors.oauth.signOut')}
        </Button>
      </div>
    );
  if (oauth.state === 'waiting')
    return (
      <div className="conn__signin" role="status">
        <span className="muted">{t('connectors.oauth.waiting')}</span>
        <span className="grow" />
        {link && (
          <Button
            size="sm"
            icon="copy"
            onClick={async () => {
              await window.lonca.shell.copy(link);
              flash(t('connectors.oauth.linkCopied'));
            }}
          >
            {t('connectors.oauth.copyLink')}
          </Button>
        )}
        <Button
          size="sm"
          variant="quiet"
          onClick={async () => onState(await core.call('connectors.cancelSignIn', { id: c.id }))}
        >
          {t('common.cancel')}
        </Button>
      </div>
    );
  return (
    <>
      <div className="conn__signin">
        <span className="muted">{t('connectors.oauth.needed')}</span>
        <span className="grow" />
        <Button size="sm" variant="primary" busy={busy} onClick={signIn}>
          {t('connectors.oauth.signIn')}
        </Button>
      </div>
      {oauth.error && oauth.error !== 'oauth_cancelled' && (
        <p className="conn__error" role="status">
          <Icon name="alert" size={13} />
          <span>
            {t(`errors.${oauth.error}`, t('errors.oauth_failed'))}
            {oauth.detail && oauth.detail !== oauth.error ? ` ${oauth.detail}` : ''}
          </span>
        </p>
      )}
    </>
  );
}

/** The host of an authorization server, as the person knows it. */
function hostOf(issuer: string | undefined): string {
  return issuer && URL.canParse(issuer) ? new URL(issuer).host : (issuer ?? '');
}

function ConnectorRow({
  c,
  onEdit,
  onState,
}: {
  c: ConnectorInfo;
  onEdit: () => void;
  onState: (s: ConnectorsState) => void;
}) {
  const { t, i18n } = useTranslation();
  const agents = useOwnAgents();
  const [confirming, setConfirming] = useState(false);
  const [open, setOpen] = useState(false);
  const names = c.agents.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean);
  const where = c.kind === 'remote' ? c.url : [c.command, ...(c.args ?? [])].join(' ');
  return (
    <motion.li layout className="prov l-card conn" aria-label={c.name}>
      <div className="prov__head">
        <Icon name="plug" size={15} />
        <b>{c.name}</b>
        <Chip>{t(`connectors.kinds.${c.kind}`)}</Chip>
        {c.source && <Chip>{c.source.from === 'catalog' ? t('catalog.verified') : t('catalog.community')}</Chip>}
        <span className={`conn__state conn__state--${c.state}`}>
          {c.state === 'failed' && c.error === 'connector_auth'
            ? t('connectors.oauth.state')
            : t(`connectors.state.${c.state}`)}
        </span>
        <span className="grow" />
        {confirming ? (
          <>
            <span className="muted">{t('connectors.deleteConfirm')}</span>
            <Button
              size="sm"
              variant="danger"
              onClick={async () => onState(await core.call('connectors.remove', { id: c.id }))}
            >
              {t('connectors.delete')}
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <>
            <IconButton
              size="sm"
              icon="refresh"
              label={t('connectors.test')}
              disabled={c.state === 'testing'}
              onClick={async () => onState(await core.call('connectors.test', { id: c.id }))}
            />
            <IconButton size="sm" icon="pencil" label={t('connectors.edit')} onClick={onEdit} />
            <IconButton size="sm" icon="trash" label={t('connectors.delete')} onClick={() => setConfirming(true)} />
          </>
        )}
      </div>
      <code className="prov__url l-mono">{where}</code>
      {c.secrets.length > 0 && (
        <div className="prov__keys">
          {c.secrets.map((s) => (
            <span key={s.name} className="keychip">
              <Icon name="key" size={12} />
              <span className="l-mono">
                {s.name} ···{s.hint.replace('…', '')}
              </span>
            </span>
          ))}
        </div>
      )}
      <SignInRow c={c} onState={onState} />
      {c.state === 'failed' && c.error !== 'connector_auth' && (
        <p className="conn__error" role="status">
          <Icon name="alert" size={13} />
          <span>{c.detail || t(`errors.${c.error ?? 'connector_failed'}`, t('errors.connector_failed'))}</span>
        </p>
      )}
      <div className="prov__models">
        <span className="muted">
          {names.length > 0 ? t('connectors.usedBy', { names: names.join(', ') }) : t('connectors.unused')}
          {c.server?.name ? ` · ${c.server.name}${c.server.version ? ` ${c.server.version}` : ''}` : ''}
          {c.tested ? ` · ${t('connectors.tested', { time: new Date(c.tested).toLocaleString(i18n.language) })}` : ''}
        </span>
        <span className="grow" />
        {c.tools.length > 0 && (
          <Button size="sm" variant="quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {t('connectors.tools', { count: c.tools.length })}
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />
          </Button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            className="conn__tools"
            aria-label={t('connectors.toolsOf', { name: c.name })}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.16 }}
          >
            {c.tools.map((tool) => (
              <ToolRow key={tool.name} c={c} tool={tool} onState={onState} />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

export function ConnectorsPanel() {
  const { t } = useTranslation();
  const [state, setState] = useConnectors();
  const [editing, setEditing] = useState<{ id?: string }>();
  const [browsing, setBrowsing] = useState(false);
  const list = state?.connectors ?? [];
  const protection = state?.protection ?? 'none';
  const existing = editing?.id ? list.find((c) => c.id === editing.id) : undefined;
  return (
    <div className="stack">
      <p className="muted">{t('connectors.intro')}</p>
      <p className={`prov__protect prov__protect--${protection}`}>
        <Icon name={protection === 'os' ? 'key' : 'alert'} size={14} />
        <span>{t(`connectors.protection.${protection}`)}</span>
      </p>
      {browsing ? (
        <ConnectorCatalog
          protection={protection}
          installed={list}
          onDone={(next) => {
            if (next) setState(next);
            setBrowsing(false);
          }}
          onManual={() => {
            setBrowsing(false);
            setEditing({});
          }}
        />
      ) : editing ? (
        <ConnectorForm
          {...(existing ? { existing } : {})}
          protection={protection}
          onDone={(next) => {
            if (next) setState(next);
            setEditing(undefined);
          }}
        />
      ) : (
        <>
          {list.length === 0 && <p className="muted">{t('connectors.empty')}</p>}
          <ul className="prov__list">
            <AnimatePresence initial={false}>
              {list.map((c) => (
                <ConnectorRow key={c.id} c={c} onEdit={() => setEditing({ id: c.id })} onState={setState} />
              ))}
            </AnimatePresence>
          </ul>
          <div className="prov__actions">
            <Button icon="plus" variant="primary" onClick={() => setBrowsing(true)}>
              {t('connectors.add')}
            </Button>
            <Button variant="quiet" onClick={() => setEditing({})}>
              {t('connectors.manual')}
            </Button>
          </div>
          <p className="muted">{t('connectors.policyNote')}</p>
        </>
      )}
    </div>
  );
}
