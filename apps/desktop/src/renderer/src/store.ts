import type { CliInfo, CliKind, Result, Settings, SettingsPatch, TailscaleInfo } from '@lonca/protocol';
import { create } from 'zustand';
import type { AppInfo, UpdateState } from '../../shared/bridge';
import i18n from './i18n';
import { core, RpcError } from './rpc';

interface AppState {
  settings?: Settings;
  agents?: CliInfo[];
  scanning: boolean;
  tailscale?: TailscaleInfo;
  system?: Result<'system.info'>;
  app?: AppInfo;
  update: UpdateState;
  /** Error code of the last failed action, shown as a translated line. */
  error?: string;
  /** Set when a CLI login console was opened; agents are scanned again when the window regains focus. */
  loginPending: boolean;
  init(): Promise<void>;
  patch(patch: SettingsPatch): Promise<void>;
  scan(): Promise<void>;
  login(kind: CliKind): Promise<void>;
  refreshTailscale(): Promise<void>;
  refreshSystem(): Promise<void>;
  clearError(): void;
}

const codeOf = (err: unknown) => (err instanceof RpcError ? err.code : 'internal');

export const useApp = create<AppState>((set, get) => ({
  scanning: false,
  update: { status: 'disabled' },
  loginPending: false,

  async init() {
    core.on('settings.changed', (settings) => {
      set({ settings });
      void i18n.changeLanguage(settings.language);
    });
    core.on('clis.changed', (agents) => set({ agents }));
    window.lonca.updates.onChange((update) => set({ update }));
    const [settings, app, update] = await Promise.all([
      core.call('settings.get'),
      window.lonca.shell.appInfo(),
      window.lonca.updates.state(),
    ]);
    await i18n.changeLanguage(settings.language);
    set({ settings, app, update });
    void get().refreshSystem();
    void get().scan();
    void get().refreshTailscale();
    // The core may restart; read its state again when a new connection arrives.
    core.onConnect(() => {
      void core.call('settings.get').then((s) => set({ settings: s }));
    });
  },

  async patch(patch) {
    // Show the change at once; the core's answer confirms it, a refusal puts the old value back.
    const before = get().settings;
    if (before) {
      set({ settings: { ...before, ...patch, profile: { ...before.profile, ...patch.profile } } });
      if (patch.language) void i18n.changeLanguage(patch.language);
    }
    try {
      const settings = await core.call('settings.update', patch);
      set({ settings, error: undefined });
      if (patch.dataDir !== undefined) void get().refreshSystem();
    } catch (err) {
      set({ error: codeOf(err), ...(before ? { settings: before } : {}) });
      if (before) void i18n.changeLanguage(before.language);
    }
  },

  async scan() {
    set({ scanning: true });
    try {
      set({ agents: await core.call('clis.list', { refresh: true }) });
    } catch (err) {
      set({ error: codeOf(err) });
    } finally {
      set({ scanning: false });
    }
  },

  async login(kind) {
    try {
      await core.call('clis.login', { kind });
      set({ loginPending: true, error: undefined });
    } catch (err) {
      set({ error: codeOf(err) });
    }
  },

  async refreshTailscale() {
    try {
      set({ tailscale: await core.call('tailscale.status') });
    } catch {
      set({ tailscale: { state: 'unknown' } });
    }
  },

  async refreshSystem() {
    try {
      set({ system: await core.call('system.info') });
    } catch (err) {
      set({ error: codeOf(err) });
    }
  },

  clearError() {
    set({ error: undefined });
  },
}));

window.addEventListener('focus', () => {
  const s = useApp.getState();
  if (s.loginPending) {
    useApp.setState({ loginPending: false });
    void s.scan();
  }
});
