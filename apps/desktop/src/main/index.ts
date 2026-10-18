import { statSync } from 'node:fs';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  MessageChannelMain,
  Notification,
  session,
  shell,
  type UtilityProcess,
  utilityProcess,
} from 'electron';
import type { UpdateState } from '../shared/bridge.js';
import { Identity } from './identity.js';
import { errorCode, Providers } from './providers.js';
import { Updater } from './updater.js';
import { loadWindowState, trackWindowState } from './window-state.js';

// LONCA_HOME gives a separate app folder (tests, a second instance next to the normal one).
if (process.env.LONCA_HOME) app.setPath('userData', process.env.LONCA_HOME);
app.setAppUserModelId('io.github.kaanisthatyou.lonca');

const here = import.meta.dirname;
const appDir = app.getPath('userData');
const devUrl = process.env.ELECTRON_RENDERER_URL;

let win: BrowserWindow | undefined;
let core: UtilityProcess | undefined;
let quitting = false;
let coreRestarts = 0;
const updater = new Updater();
let providers: Providers | undefined;
let identity: Identity | undefined;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(start);
}

function startCore(): void {
  core = utilityProcess.fork(join(here, 'core.js'), [], {
    serviceName: 'Lonca core',
    env: {
      ...process.env,
      LONCA_APP_DIR: appDir,
      LONCA_LOCALE: process.env.LONCA_LANG ?? app.getLocale(),
    },
  });
  providers?.attach(core);
  identity?.attach(core);
  core.on('exit', () => {
    core = undefined;
    if (quitting || coreRestarts > 5) return;
    coreRestarts += 1;
    setTimeout(() => {
      startCore();
      if (win && !win.isDestroyed()) connect(win);
    }, 500 * coreRestarts);
  });
}

/** Gives the page its own channel to the core; called again after every reload. */
function connect(target: BrowserWindow): void {
  if (!core) return;
  const { port1, port2 } = new MessageChannelMain();
  core.postMessage({ type: 'connect' }, [port1]);
  target.webContents.postMessage('lonca:port', null, [port2]);
}

function isOwnPage(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  return devUrl ? url.startsWith(devUrl) : url.startsWith('file://');
}

function handle<T>(channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => T): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isOwnPage(event)) throw new Error('refused');
    return fn(event, ...args);
  });
}

function registerIpc(): void {
  handle('shell:pickFolder', async () => {
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  handle('shell:openExternal', async (_e, url) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) await shell.openExternal(url);
  });
  handle('shell:openFolder', async (_e, path) => {
    // Folders only: a file path could start a program.
    if (typeof path === 'string' && statSync(path, { throwIfNoEntry: false })?.isDirectory())
      await shell.openPath(path);
  });
  handle('shell:copy', (_e, text) => {
    if (typeof text === 'string') clipboard.writeText(text);
  });
  handle('shell:appInfo', () => ({ version: app.getVersion(), platform: process.platform, packaged: app.isPackaged }));
  handle('shell:setTitleBar', (_e, colors) => {
    const c = colors as { background?: unknown; symbols?: unknown };
    if (!win || typeof c?.background !== 'string' || typeof c.symbols !== 'string') return;
    if (process.platform !== 'darwin') win.setTitleBarOverlay({ color: c.background, symbolColor: c.symbols });
    win.setBackgroundColor(c.background);
  });
  handle('shell:notify', (_e, title, body) => {
    if (typeof title !== 'string' || typeof body !== 'string' || !Notification.isSupported()) return;
    const n = new Notification({ title: title.slice(0, 120), body: body.slice(0, 300), silent: false });
    n.on('click', () => {
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });
    n.show();
  });
  // Providers: a refusal travels as its error code in the message.
  const guarded =
    <A extends unknown[], T>(fn: (...args: A) => T | Promise<T>) =>
    async (_e: IpcMainInvokeEvent, ...args: unknown[]) => {
      try {
        return await fn(...(args as A));
      } catch (e) {
        throw new Error(errorCode(e));
      }
    };
  handle(
    'providers:state',
    guarded(() => providers?.state()),
  );
  handle(
    'providers:save',
    guarded((input: unknown) => providers?.save(input)),
  );
  handle(
    'providers:remove',
    guarded((id: unknown) => providers?.remove(id)),
  );
  handle(
    'providers:removeKey',
    guarded((id: unknown, keyId: unknown) => providers?.removeKey(id, keyId)),
  );
  handle(
    'providers:models',
    guarded((id: unknown) => providers?.models(id)),
  );
  handle('update:state', () => updater.get());
  handle('update:check', () => updater.check());
  handle('update:install', () => updater.install());
  updater.onChange((state: UpdateState) => {
    if (win && !win.isDestroyed()) win.webContents.send('update:changed', state);
  });
}

function hardenSessions(): void {
  // Nothing in Lonca needs camera, location or notifications from the page yet; the microphone comes with voice.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(permission === 'clipboard-sanitized-write'),
  );
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (url !== contents.getURL()) event.preventDefault();
    });
  });
}

function createWindow(): BrowserWindow {
  const state = loadWindowState(appDir);
  const w = new BrowserWindow({
    ...state,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Lonca',
    backgroundColor: '#0a0b0d',
    titleBarStyle: 'hidden',
    ...(process.platform !== 'darwin'
      ? { titleBarOverlay: { color: '#08090a', symbolColor: '#969ca7', height: 36 } }
      : {}),
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  if (state.maximized) w.maximize();
  trackWindowState(w, appDir);
  w.once('ready-to-show', () => w.show());
  w.webContents.on('did-finish-load', () => connect(w));
  if (devUrl) void w.loadURL(devUrl);
  else void w.loadFile(join(here, '../renderer/index.html'));
  return w;
}

function start(): void {
  providers = new Providers(appDir);
  identity = new Identity(appDir);
  providers.onChange((state) => {
    if (win && !win.isDestroyed()) win.webContents.send('providers:changed', state);
  });
  hardenSessions();
  registerIpc();
  startCore();
  win = createWindow();
  win.on('closed', () => {
    win = undefined;
  });
  updater.start();
}

app.on('before-quit', () => {
  quitting = true;
  core?.kill();
});

app.on('window-all-closed', () => {
  app.quit();
});
