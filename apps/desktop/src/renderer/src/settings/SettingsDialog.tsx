import { Button, Icon, IconButton, type IconName, TextField } from '@lonca/ui';
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
    </div>
  );
}

function Appearance() {
  const { t } = useTranslation();
  return (
    <div className="stack">
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
      <AppearancePreview />
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
        <b>Lonca</b> · <span className="l-mono">{app?.version}</span>
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
