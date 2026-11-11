import { CLOCKS, CREW_LAYOUTS, DENSITIES, START_VIEWS, TEXT_SIZES } from '@lonca/protocol';
import { Button, Chip, Icon, IconButton, type IconName, Segmented, Switch, TextField } from '@lonca/ui';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccentPicker,
  AgentList,
  AppearancePreview,
  DataFolder,
  ErrorLine,
  LanguagePicker,
  MotionPicker,
  TailscaleRow,
  ThemePicker,
} from '../parts';
import { useApp } from '../store';
import { ConnectorsPanel } from './ConnectorsPanel';
import { InstructionsPanel } from './InstructionsPanel';
import { PhonePanel } from './PhonePanel';
import { ProvidersPanel } from './ProvidersPanel';
import { ShortcutsPanel } from './ShortcutsPanel';

const TABS: {
  id:
    | 'general'
    | 'appearance'
    | 'agents'
    | 'providers'
    | 'connectors'
    | 'instructions'
    | 'shortcuts'
    | 'team'
    | 'phone'
    | 'updates'
    | 'about';
  icon: IconName;
}[] = [
  { id: 'general', icon: 'settings' },
  { id: 'appearance', icon: 'sun' },
  { id: 'agents', icon: 'terminal' },
  { id: 'providers', icon: 'key' },
  { id: 'connectors', icon: 'plug' },
  { id: 'instructions', icon: 'layers' },
  { id: 'shortcuts', icon: 'keyboard' },
  { id: 'team', icon: 'network' },
  { id: 'phone', icon: 'monitor' },
  { id: 'updates', icon: 'download' },
  { id: 'about', icon: 'globe' },
];
type Tab = (typeof TABS)[number]['id'];
/** Tabs about this computer itself: not offered on a phone. */
const DESKTOP_ONLY = new Set<Tab>(['providers', 'connectors', 'phone', 'updates', 'team']);
const onPhone = typeof document !== 'undefined' && document.documentElement.dataset.phone === '1';

function General() {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patch);
  const [name, setName] = useState(settings?.profile.name ?? '');
  const save = () => {
    const clean = name.trim();
    if (clean && clean !== settings?.profile.name) void patch({ profile: { name: clean } });
  };
  return (
    <div className="stack">
      <section className="set">
        <h4>{t('settings.language')}</h4>
        <LanguagePicker />
      </section>
      <section className="set">
        <TextField
          label={t('settings.name')}
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={(e: { key: string }) => e.key === 'Enter' && save()}
        />
      </section>
      <section className="set">
        <h4>{t('settings.dataFolder')}</h4>
        <DataFolder />
      </section>
      <section className="set">
        <h4>{t('settings.quietHours')}</h4>
        <div className="quiet">
          <TextField
            label={t('settings.quietFrom')}
            type="time"
            value={settings?.quietHours.from ?? '23:00'}
            onChange={(e) =>
              e.target.value &&
              void patch({ quietHours: { from: e.target.value, to: settings?.quietHours.to ?? '08:00' } })
            }
          />
          <TextField
            label={t('settings.quietTo')}
            type="time"
            value={settings?.quietHours.to ?? '08:00'}
            onChange={(e) =>
              e.target.value &&
              void patch({ quietHours: { from: settings?.quietHours.from ?? '23:00', to: e.target.value } })
            }
          />
        </div>
        <p className="muted">{t('settings.quietHint')}</p>
      </section>
      {!onPhone && (
        <section className="set">
          <h4>{t('settings.notifications')}</h4>
          <div className="row-field">
            <Switch
              checked={settings?.notifications !== false}
              onChange={(notifications) => void patch({ notifications })}
              label={t('settings.notificationsLabel')}
            />
            <span>{t('settings.notificationsLabel')}</span>
          </div>
          <p className="muted">{t('settings.notificationsHint')}</p>
        </section>
      )}
      {!onPhone && (
        <section className="set">
          <h4>{t('settings.agentFolder')}</h4>
          <AgentFolder />
        </section>
      )}
    </div>
  );
}

/** Where an agent works when its form names no folder: a folder picked here, else the desktop. */
function AgentFolder() {
  const { t } = useTranslation();
  const system = useApp((s) => s.system);
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patch);
  if (!system || !settings) return null;
  return (
    <div className="folder">
      <div className="folder__path l-card">
        <Icon name="folder" />
        <span className="l-mono l-selectable">{system.agentFolder}</span>
        {!settings.agentFolder && <Chip>{t('settings.agentFolderDesktop')}</Chip>}
      </div>
      <div className="folder__actions">
        <Button
          icon="folder"
          onClick={async () => {
            const dir = await window.lonca.shell.pickFolder();
            if (dir) await patch({ agentFolder: dir });
          }}
        >
          {t('common.change')}
        </Button>
        {settings.agentFolder && (
          <Button variant="quiet" onClick={() => void patch({ agentFolder: '' })}>
            {t('common.useDefault')}
          </Button>
        )}
      </div>
      <p className="muted">{t('settings.agentFolderHint')}</p>
    </div>
  );
}

function Appearance() {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patch);
  if (!settings) return null;
  return (
    <div className="stack">
      <section className="set">
        <div className="set__rows">
          <div className="row-field">
            <span className="row-field__label">{t('launcher.appearance.theme')}</span>
            <ThemePicker id="settings" />
          </div>
          <div className="row-field">
            <span className="row-field__label">{t('launcher.appearance.accent')}</span>
            <AccentPicker />
          </div>
          <div className="row-field">
            <span className="row-field__label">{t('launcher.appearance.motion')}</span>
            <MotionPicker id="settings" />
          </div>
          {!onPhone && (
            <div className="row-field">
              <span className="row-field__label">{t('settings.textSize')}</span>
              <Segmented
                layoutId="set-text"
                label={t('settings.textSize')}
                value={settings.textSize}
                onChange={(textSize) => void patch({ textSize })}
                options={TEXT_SIZES.map((v) => ({ value: v, label: t(`settings.textSizes.${v}`) }))}
              />
            </div>
          )}
          <div className="row-field">
            <span className="row-field__label">{t('settings.density')}</span>
            <Segmented
              layoutId="set-density"
              label={t('settings.density')}
              value={settings.density}
              onChange={(density) => void patch({ density })}
              options={DENSITIES.map((v) => ({ value: v, label: t(`settings.densities.${v}`) }))}
            />
          </div>
          <div className="row-field">
            <span className="row-field__label">{t('settings.clock')}</span>
            <Segmented
              layoutId="set-clock"
              label={t('settings.clock')}
              value={settings.clock}
              onChange={(clock) => void patch({ clock })}
              options={CLOCKS.map((v) => ({ value: v, label: t(`settings.clocks.${v}`) }))}
            />
          </div>
        </div>
      </section>
      <AppearancePreview />
      <section className="set">
        <h4>{t('settings.layout')}</h4>
        <div className="set__rows">
          {!onPhone && (
            <>
              <div className="row-field">
                <span className="row-field__label">{t('settings.crew')}</span>
                <Segmented
                  layoutId="set-crew"
                  label={t('settings.crew')}
                  value={settings.crew}
                  onChange={(crew) => void patch({ crew })}
                  options={CREW_LAYOUTS.map((v) => ({
                    value: v,
                    label: t(`settings.crews.${v}`),
                    icon: v === 'panel' ? ('panelRight' as const) : ('users' as const),
                  }))}
                />
              </div>
              <div className="row-field">
                <span className="row-field__label">{t('settings.sidebar')}</span>
                <Segmented
                  layoutId="set-sidebar"
                  label={t('settings.sidebar')}
                  value={settings.sidebar ? 'on' : 'off'}
                  onChange={(v) => void patch({ sidebar: v === 'on' })}
                  options={[
                    { value: 'on', label: t('settings.sidebars.on') },
                    { value: 'off', label: t('settings.sidebars.off') },
                  ]}
                />
              </div>
            </>
          )}
          <div className="row-field">
            <span className="row-field__label">{t('settings.startView')}</span>
            <Segmented
              layoutId="set-start"
              label={t('settings.startView')}
              value={settings.startView}
              onChange={(startView) => void patch({ startView })}
              options={START_VIEWS.map((v) => ({ value: v, label: t(`settings.startViews.${v}`) }))}
            />
          </div>
        </div>
        {!onPhone && <p className="muted">{t('settings.crewHint')}</p>}
      </section>
    </div>
  );
}

function Updates() {
  const { t } = useTranslation();
  const update = useApp((s) => s.update);
  const app = useApp((s) => s.app);
  const [busy, setBusy] = useState(false);
  const text =
    update.status === 'downloading'
      ? t('update.downloading', { percent: update.percent ?? 0 })
      : t(`update.${update.status}`, { version: update.version ?? '' });
  return (
    <div className="stack">
      <div className="upd l-card">
        <div>
          <b>{t('settings.version', { version: app?.version ?? '' })}</b>
          <p className="muted">{text}</p>
        </div>
        {update.status === 'ready' ? (
          <Button variant="primary" icon="download" onClick={() => void window.lonca.updates.install()}>
            {t('update.restart')}
          </Button>
        ) : (
          <Button
            icon="refresh"
            busy={busy || update.status === 'checking'}
            disabled={update.status === 'disabled'}
            onClick={async () => {
              setBusy(true);
              await window.lonca.updates.check();
              setBusy(false);
            }}
          >
            {t('update.check')}
          </Button>
        )}
      </div>
    </div>
  );
}

function About() {
  const { t } = useTranslation();
  const app = useApp((s) => s.app);
  return (
    <div className="stack">
      <p>
        <b>Serai</b> · <span className="l-mono">{app?.version}</span>
      </p>
      <p className="muted">{t('launcher.tagline')}</p>
      <p className="muted">{t('settings.license')}</p>
      <div>
        <Button
          icon="external"
          onClick={() => void window.lonca.shell.openExternal('https://github.com/kaanisthatyou/lonca')}
        >
          {t('settings.source')}
        </Button>
      </div>
    </div>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('general');
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <motion.div
      className="l-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        className="l-dialog settings"
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 460, damping: 34 } }}
        exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
      >
        <nav className="settings__nav" aria-label={t('settings.title')}>
          <h3>{t('settings.title')}</h3>
          {TABS.filter((x) => !(onPhone && DESKTOP_ONLY.has(x.id))).map((x) => (
            <button
              key={x.id}
              type="button"
              className={`nav ${tab === x.id ? 'is-on' : ''}`}
              aria-current={tab === x.id ? 'page' : undefined}
              onClick={() => setTab(x.id)}
            >
              {tab === x.id && <motion.span layoutId="settings-on" className="nav__on" />}
              <Icon name={x.icon} size={14} />
              <span className="grow">{t(`settings.tabs.${x.id}`)}</span>
            </button>
          ))}
        </nav>
        <div className="settings__body">
          <header className="settings__head">
            <h2>{t(`settings.tabs.${tab}`)}</h2>
            <IconButton ref={closeRef} icon="close" label={t('common.close')} onClick={onClose} />
          </header>
          <motion.div
            key={tab}
            className="settings__content"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
          >
            {tab === 'general' && <General />}
            {tab === 'appearance' && <Appearance />}
            {tab === 'agents' && <AgentList />}
            {tab === 'providers' && <ProvidersPanel />}
            {tab === 'connectors' && <ConnectorsPanel />}
            {tab === 'instructions' && <InstructionsPanel />}
            {tab === 'shortcuts' && <ShortcutsPanel />}
            {tab === 'team' && <TailscaleRow />}
            {tab === 'phone' && <PhonePanel />}
            {tab === 'updates' && <Updates />}
            {tab === 'about' && <About />}
          </motion.div>
          <ErrorLine />
        </div>
      </motion.div>
    </motion.div>
  );
}
