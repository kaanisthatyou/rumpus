// Pieces shared by the launcher and the settings dialog.
import { ACCENTS, type CliInfo, type CliKind, LANGUAGES } from '@lonca/protocol';
import {
  ACCENT_SWATCHES,
  Avatar,
  Button,
  Chip,
  Icon,
  IconButton,
  LiveDot,
  popIn,
  Segmented,
  stagger,
  Track,
} from '@lonca/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from './store';

const LANGUAGE_NAMES = { tr: 'Türkçe', en: 'English' } as const;

export function LanguagePicker() {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patch);
  if (!settings) return null;
  return (
    <fieldset className="pick-grid">
      <legend className="l-sr">{t('launcher.steps.language')}</legend>
      {LANGUAGES.map((lang) => (
        <label key={lang} className="pick-card" data-checked={settings.language === lang || undefined}>
          <input
            type="radio"
            className="l-sr"
            name="language"
            value={lang}
            aria-label={LANGUAGE_NAMES[lang]}
            checked={settings.language === lang}
            onChange={() => void patch({ language: lang })}
          />
          <span className="pick-card__code l-mono" aria-hidden="true">
            {lang.toUpperCase()}
          </span>
          <span className="pick-card__name">{LANGUAGE_NAMES[lang]}</span>
          {settings.language === lang && (
            <motion.span layoutId="lang-check" className="pick-card__check">
              <Icon name="check" size={14} />
            </motion.span>
          )}
        </label>
      ))}
    </fieldset>
  );
}

export function ThemePicker({ id }: { id: string }) {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patch);
  if (!settings) return null;
  return (
    <Segmented
      layoutId={`theme-${id}`}
      label={t('launcher.appearance.theme')}
      value={settings.theme}
      onChange={(theme) => void patch({ theme })}
      options={[
        { value: 'dark', label: t('theme.dark'), icon: 'moon' },
        { value: 'light', label: t('theme.light'), icon: 'sun' },
        { value: 'system', label: t('theme.system'), icon: 'monitor' },
      ]}
    />
  );
}

export function MotionPicker({ id }: { id: string }) {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patch);
  if (!settings) return null;
  return (
    <Segmented
      layoutId={`motion-${id}`}
      label={t('launcher.appearance.motion')}
      value={settings.motion}
      onChange={(motion) => void patch({ motion })}
      options={[
        { value: 'system', label: t('motion.system') },
        { value: 'reduced', label: t('motion.reduced') },
      ]}
    />
  );
}

export function AccentPicker() {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patch);
  if (!settings) return null;
  return (
    <fieldset className="swatches">
      <legend className="l-sr">{t('launcher.appearance.accent')}</legend>
      {ACCENTS.map((accent) => (
        <label
          key={accent}
          title={t(`accent.${accent}`)}
          className="swatch"
          style={{ background: ACCENT_SWATCHES[accent] }}
        >
          <input
            type="radio"
            className="l-sr"
            name="accent"
            value={accent}
            aria-label={t(`accent.${accent}`)}
            checked={settings.accent === accent}
            onChange={() => void patch({ accent })}
          />
          {settings.accent === accent && (
            <motion.span
              layoutId="accent-ring"
              className="swatch__ring"
              transition={{ type: 'spring', stiffness: 520, damping: 34 }}
            />
          )}
        </label>
      ))}
    </fieldset>
  );
}

/** A small job card that shows the accent and the motion in use. */
export function AppearancePreview() {
  const { t } = useTranslation();
  return (
    <div className="preview l-card" aria-hidden="true">
      <div className="preview__top">
        <Avatar name="" icon="terminal" size={28} />
        <div className="preview__name">
          <b>{t('launcher.appearance.previewJob')}</b>
          <span>
            <Chip mono>claude-code</Chip>
          </span>
        </div>
        <span className="preview__state">
          <LiveDot />
          {t('launcher.appearance.previewState')}
        </span>
      </div>
      <Track busy />
      <div className="preview__steps l-mono">
        <span className="ok">
          <Icon name="check" size={12} />
        </span>
        config/economy.ts <span className="add">+38</span> <span className="del">−12</span>
      </div>
    </div>
  );
}

export function DataFolder() {
  const { t } = useTranslation();
  const system = useApp((s) => s.system);
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patch);
  if (!system || !settings) return null;
  const pick = async () => {
    const dir = await window.lonca.shell.pickFolder();
    if (dir) await patch({ dataDir: dir });
  };
  return (
    <div className="folder">
      <div className="folder__path l-card">
        <Icon name="folder" />
        <span className="l-mono l-selectable">{system.dataDir}</span>
        {!settings.dataDir && <Chip>{t('launcher.data.isDefault')}</Chip>}
      </div>
      <div className="folder__actions">
        <Button icon="folder" onClick={() => void pick()}>
          {t('common.change')}
        </Button>
        {settings.dataDir && (
          <Button variant="quiet" onClick={() => void patch({ dataDir: '' })}>
            {t('common.useDefault')}
          </Button>
        )}
      </div>
    </div>
  );
}

function CopyLine({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="copyline">
      <code className="l-selectable">{text}</code>
      <Button
        size="sm"
        icon={copied ? 'check' : 'copy'}
        onClick={() => {
          void window.lonca.shell.copy(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? t('common.copied') : t('common.copy')}
      </Button>
    </div>
  );
}

function stateTone(state: CliInfo['state']): 'ok' | 'warn' | undefined {
  if (state === 'ready') return 'ok';
  if (state === 'signed-out' || state === 'needs-key') return 'warn';
  return undefined;
}

function AgentRow({ agent }: { agent: CliInfo }) {
  const { t } = useTranslation();
  const login = useApp((s) => s.login);
  const platform = useApp((s) => s.system?.platform);
  const command = platform === 'win32' ? agent.install.windows : agent.install.linux;
  const details = [
    agent.version && `v${agent.version}`,
    agent.auth && t(`agent.auth.${agent.auth}`, agent.auth),
    agent.plan,
  ]
    .filter(Boolean)
    .join(' · ');
  const google = agent.kind === 'gemini' || agent.kind === 'antigravity';
  return (
    <motion.li variants={popIn} className={`agent ${agent.state === 'missing' ? 'agent--missing' : ''}`}>
      <div className="agent__row">
        <Avatar name="" icon="terminal" size={32} presence={agent.state === 'ready' ? 'on' : 'off'} />
        <div className="agent__text">
          <b>{t(`agent.kind.${agent.kind}`)}</b>
          <span className="l-mono">{details || '—'}</span>
        </div>
        <Chip {...(stateTone(agent.state) ? { tone: stateTone(agent.state) } : {})}>
          {t(`agent.state.${agent.state}`)}
        </Chip>
        {agent.canLogin && (agent.state === 'signed-out' || agent.state === 'unknown') && (
          <Button size="sm" icon="login" onClick={() => void login(agent.kind)}>
            {t('agent.login')}
          </Button>
        )}
        <IconButton
          size="sm"
          icon="external"
          label={t('common.docs')}
          onClick={() => void window.lonca.shell.openExternal(agent.install.docs)}
        />
      </div>
      {agent.state === 'missing' && command && <CopyLine text={command} />}
      {google && agent.state !== 'missing' && <p className="agent__note">{t('agent.googleNote')}</p>}
    </motion.li>
  );
}

/** Extra logins of a CLI on this computer (Fabrika's second worker): each is the CLI's own config folder. */
function Accounts() {
  const { t } = useTranslation();
  const accounts = useApp((s) => s.accounts);
  const clis = useApp((s) => s.clis);
  const login = useApp((s) => s.login);
  const addAccount = useApp((s) => s.addAccount);
  const removeAccount = useApp((s) => s.removeAccount);
  const kinds = (clis ?? [])
    .filter((c) => (c.kind === 'claude-code' || c.kind === 'codex') && c.state !== 'missing')
    .map((c) => c.kind);
  const [kind, setKind] = useState<CliKind | ''>('');
  const [name, setName] = useState('');
  const chosen = kind || kinds[0];
  if (kinds.length === 0 && accounts.length === 0) return null;
  return (
    <section className="accounts" aria-label={t('accounts.title')}>
      <h3 className="accounts__title">{t('accounts.title')}</h3>
      <p className="muted accounts__hint">{t('accounts.hint')}</p>
      {accounts.length > 0 && (
        <ul className="agents__list">
          {accounts.map((a) => (
            <li key={a.id} className="agent">
              <div className="agent__row">
                <Avatar name={a.name} size={32} presence={a.state === 'ready' ? 'on' : 'off'} />
                <div className="agent__text">
                  <b>{a.name}</b>
                  <span className="l-mono">
                    {[t(`agent.kind.${a.kind}`), a.auth && t(`agent.auth.${a.auth}`, a.auth), a.plan]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                <Chip {...(stateTone(a.state) ? { tone: stateTone(a.state) } : {})}>{t(`agent.state.${a.state}`)}</Chip>
                {a.state !== 'ready' && a.state !== 'missing' && (
                  <Button size="sm" icon="login" onClick={() => void login(a.kind, a.id)}>
                    {t('agent.login')}
                  </Button>
                )}
                <IconButton
                  size="sm"
                  icon="trash"
                  label={t('accounts.remove', { name: a.name })}
                  onClick={() => void removeAccount(a.id)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {kinds.length > 0 && chosen && (
        <form
          className="accounts__add"
          onSubmit={async (e) => {
            e.preventDefault();
            if (name.trim() && (await addAccount(chosen, name.trim()))) setName('');
          }}
        >
          <select
            className="l-input"
            aria-label={t('accounts.kind')}
            value={chosen}
            onChange={(e) => setKind(e.target.value as CliKind)}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(`agent.kind.${k}`)}
              </option>
            ))}
          </select>
          <input
            className="l-input grow"
            value={name}
            maxLength={40}
            placeholder={t('accounts.namePlaceholder')}
            aria-label={t('accounts.name')}
            onChange={(e) => setName(e.target.value)}
          />
          <Button size="sm" icon="plus" type="submit" disabled={!name.trim()}>
            {t('accounts.add')}
          </Button>
        </form>
      )}
    </section>
  );
}

export function AgentList() {
  const { t } = useTranslation();
  const agents = useApp((s) => s.clis);
  const scanning = useApp((s) => s.scanning);
  const scan = useApp((s) => s.scan);
  const loginPending = useApp((s) => s.loginPending);
  const ready = agents?.filter((a) => a.state === 'ready').length ?? 0;
  // Installed first, then the rest, in the order of the spec list.
  const sorted = agents
    ? [...agents].sort((a, b) => Number(a.state === 'missing') - Number(b.state === 'missing'))
    : [];
  return (
    <div className="agents">
      <div className="agents__bar">
        <span className="agents__count">
          {agents
            ? ready > 0
              ? t('launcher.agents.readyCount', { count: ready })
              : t('launcher.agents.none')
            : t('common.scanning')}
        </span>
        <Button size="sm" icon="refresh" busy={scanning} onClick={() => void scan()}>
          {scanning ? t('common.scanning') : t('common.rescan')}
        </Button>
      </div>
      <AnimatePresence>
        {loginPending && (
          <motion.p
            className="agents__info"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {t('agent.loginOpened')}
          </motion.p>
        )}
      </AnimatePresence>
      {agents && (
        <motion.ul
          className="agents__list"
          variants={stagger}
          initial="hidden"
          animate="shown"
          key={agents.map((a) => a.state).join()}
        >
          {sorted.map((a) => (
            <AgentRow key={a.kind} agent={a} />
          ))}
        </motion.ul>
      )}
      <Accounts />
    </div>
  );
}

export function TailscaleRow() {
  const { t } = useTranslation();
  const info = useApp((s) => s.tailscale);
  const refresh = useApp((s) => s.refreshTailscale);
  const [busy, setBusy] = useState(false);
  const state = info?.state ?? 'unknown';
  return (
    <div className="ts l-card">
      <div className="agent__row">
        <Avatar name="" icon="network" size={32} presence={state === 'running' ? 'on' : 'off'} />
        <div className="agent__text">
          <b>{t('tailscale.name')}</b>
          <span className="l-mono">{[info?.host, info?.ip].filter(Boolean).join(' · ') || '—'}</span>
        </div>
        <Chip {...(state === 'running' ? { tone: 'ok' as const } : {})}>{t(`tailscale.state.${state}`)}</Chip>
        <Button
          size="sm"
          icon="refresh"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            await refresh();
            setBusy(false);
          }}
        >
          {t('common.rescan')}
        </Button>
      </div>
      <p className="agent__note">{t(`tailscale.hint.${state}`)}</p>
      {state === 'missing' && (
        <Button
          size="sm"
          icon="download"
          onClick={() => void window.lonca.shell.openExternal('https://tailscale.com/download')}
        >
          {t('tailscale.download')}
        </Button>
      )}
    </div>
  );
}

export function ErrorLine() {
  const { t } = useTranslation();
  const error = useApp((s) => s.error);
  const clear = useApp((s) => s.clearError);
  return (
    <AnimatePresence>
      {error && (
        <motion.div
          className="errline"
          role="alert"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
        >
          <Icon name="alert" size={14} />
          <span>{t(`errors.${error}`, t('errors.internal'))}</span>
          <IconButton size="sm" icon="close" label={t('common.close')} onClick={clear} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
