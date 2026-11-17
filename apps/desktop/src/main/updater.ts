// Updates from GitHub Releases through electron-updater. Off in development builds.
import { app } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateState } from '../shared/bridge.js';

const { autoUpdater } = electronUpdater;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const BUSY = new Set<UpdateState['status']>(['checking', 'available', 'downloading', 'ready']);

export class Updater {
  private state: UpdateState;
  private readonly listeners = new Set<(s: UpdateState) => void>();
  private readonly enabled: boolean;

  constructor() {
    // LONCA_UPDATE_TEST lets a development build talk to a test feed (dev-app-update.yml).
    this.enabled = app.isPackaged || process.env.LONCA_UPDATE_TEST === '1';
    this.state = { status: this.enabled ? 'idle' : 'disabled' };
    if (!this.enabled) return;
    if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true;
    // Test hook: a local feed only (e2e/update.mjs). Release builds otherwise read GitHub from app-update.yml.
    const testFeed = process.env.LONCA_UPDATE_URL;
    const testing = Boolean(testFeed && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(testFeed));
    if (testing && testFeed) autoUpdater.setFeedURL({ provider: 'generic', url: testFeed });
    autoUpdater.autoDownload = true;
    // A test must never install what it downloaded when the app closes. (This line used to stand before an
    // unconditional `true`, which undid it.)
    autoUpdater.autoInstallOnAppQuit = !testing;
    autoUpdater.allowPrerelease = app.getVersion().includes('-');
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }));
    // autoDownload starts at once, and a differential download may send no progress at all: show it as a
    // download from the first moment, or the card sits on "found" and looks like it needs another press.
    autoUpdater.on('update-available', (info) =>
      this.set({ status: 'downloading', percent: 0, version: info.version }),
    );
    autoUpdater.on('update-not-available', () => this.set({ status: 'none' }));
    autoUpdater.on('download-progress', (p) =>
      this.set({ status: 'downloading', percent: Math.round(p.percent), ...this.version() }),
    );
    autoUpdater.on('update-downloaded', (info) => this.set({ status: 'ready', version: info.version }));
    autoUpdater.on('error', () => this.set({ status: 'error' }));
  }

  private version(): { version?: string } {
    return this.state.version ? { version: this.state.version } : {};
  }

  private set(next: UpdateState): void {
    this.state = next;
    for (const l of this.listeners) l(next);
  }

  get(): UpdateState {
    return this.state;
  }

  onChange(listener: (s: UpdateState) => void): void {
    this.listeners.add(listener);
  }

  start(): void {
    if (!this.enabled) return;
    setTimeout(() => void this.check(), 15_000);
    setInterval(() => void this.check(), CHECK_EVERY_MS).unref();
  }

  // One press does the whole pull: check, and with autoDownload the download. A check or download already under
  // way is joined rather than started again; a failed first attempt (a cold network, GitHub's feed) is retried
  // once before the card says so.
  async check(): Promise<UpdateState> {
    if (!this.enabled || BUSY.has(this.state.status)) return this.state;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await autoUpdater.checkForUpdates();
      } catch {
        this.set({ status: 'error' });
      }
      if (this.state.status !== 'error') break;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
    return this.state;
  }

  install(): void {
    if (this.state.status === 'ready') autoUpdater.quitAndInstall(false, true);
  }
}
