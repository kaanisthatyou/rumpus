import type { Platform, ProviderInfo, ProviderInput, ProvidersState } from '@lonca/protocol';

// What the preload script exposes to the page as `window.lonca`: the few things only Electron's main process
// can do. Everything else goes to the core over the message port.

export type UpdateStatus = 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error';

export interface UpdateState {
  status: UpdateStatus;
  version?: string;
  percent?: number;
}

export interface AppInfo {
  version: string;
  platform: Platform;
  packaged: boolean;
}

/** What the main process needs to run without a window (Settings → General), with the tray's words. */
export interface BackgroundSettings {
  tray: boolean;
  startAtLogin: boolean;
  labels: {
    /** The tray icon's tooltip. */
    tip: string;
    open: string;
    quit: string;
    /** Said once, the first time closing the window leaves the app in the tray. */
    hidden: string;
  };
}

/** A report arrived (PLAN.md 5.21): what the toast over the screen's lower right corner shows. */
export interface ReportToast {
  /** The report's message id. */
  id: string;
  title: string;
  /** The agent that wrote it. */
  by: string;
  /** Its short code (`4F2A1C`). */
  code: string;
  /** Reports that arrived together (the toast shows the newest and how many more). */
  count: number;
  /** Questions it leaves to the person. */
  decisions: number;
  look: { theme: 'dark' | 'light'; accent: string; motion: string };
  labels: { kind: string; open: string; close: string; more: string; decisions: string };
}

export interface LoncaBridge {
  shell: {
    pickFolder(): Promise<string | null>;
    openExternal(url: string): Promise<void>;
    /** Opens a folder in the system's file manager (folders only). */
    openFolder(path: string): Promise<void>;
    copy(text: string): Promise<void>;
    appInfo(): Promise<AppInfo>;
    setTitleBar(colors: { background: string; symbols: string }): Promise<void>;
    /** The text size: everything in the window drawn at this factor (0.8 to 1.3). */
    setZoom(factor: number): Promise<void>;
    /** An OS notification; clicking it brings Rumpus forward. `silent`: the app plays its own sound for it. */
    notify(title: string, body: string, silent?: boolean): Promise<void>;
    /**
     * What this computer's agents are doing, for the taskbar: a moving bar while jobs run, a held one and a badge
     * (a small picture drawn by the page, as a PNG data URL) while jobs wait for approval.
     */
    setActivity(activity: { running: number; waiting: number; badge?: string }): Promise<void>;
    /**
     * Running without a window: whether closing it leaves the app in the tray, whether it starts with the system,
     * and the tray's words in the person's language.
     */
    setBackground(background: BackgroundSettings): Promise<void>;
    /** The window was hidden in the tray (false) or shown again (true). */
    onShown(listener: (shown: boolean) => void): () => void;
  };
  /**
   * The report toast: Bub over the screen's lower right corner when a report arrives, whatever window is in front.
   * `show` comes from the main window; the toast's own page gets it with `onShow`, and a click on it reaches the
   * main window as `onOpen`.
   */
  toast: {
    show(toast: ReportToast): Promise<void>;
    onShow(listener: (toast: ReportToast) => void): () => void;
    /** From the toast, once its page is up: the toast it was made for (sent before it listened). */
    pending(): Promise<ReportToast | null>;
    /** From the toast: open this report in the main window. */
    open(id: string): Promise<void>;
    /** From the toast: it is done (its time is up, or it was closed). */
    hide(): Promise<void>;
    /** From the toast: the pointer is over it (true), or over the desktop around it. */
    solid(on: boolean): Promise<void>;
    onOpen(listener: (id: string) => void): () => void;
  };
  /** Invite links (`rumpus://join/<code>`) the app was opened with. */
  links: {
    /** A link that arrived before the page was ready; it is handed out once. */
    pending(): Promise<string | null>;
    onJoin(listener: (link: string) => void): () => void;
  };
  /** The island: quick entry as a see-through layer over the screen (Ctrl Alt Space from anywhere). */
  quick: {
    open(): Promise<void>;
    hide(): Promise<void>;
    /** From the island's page: the pointer is over its text box or a bubble (true), or over the desktop. */
    solid(on: boolean): Promise<void>;
    /** Brings the main window forward. */
    openApp(): Promise<void>;
    /** Registers the global key (`Ctrl+Alt+Space`); false when another app holds it (the old key stays). */
    setKey(combo: string): Promise<boolean>;
    /** The key that really opens the island now; null while another app holds it. */
    key(): Promise<string | null>;
    /** The key changed (registered after all, or set in Settings). */
    onKey(listener: (combo: string) => void): () => void;
  };
  /** Model providers and their keys; keys go in and never come back out. Refusals reject with an error code. */
  providers: {
    state(): Promise<ProvidersState>;
    save(input: ProviderInput): Promise<ProviderInfo>;
    remove(id: string): Promise<void>;
    removeKey(id: string, keyId: string): Promise<ProviderInfo>;
    /** Fetches the provider's model list; costs no tokens. */
    models(id: string): Promise<ProviderInfo>;
    onChange(listener: (state: ProvidersState) => void): () => void;
  };
  updates: {
    state(): Promise<UpdateState>;
    check(): Promise<UpdateState>;
    install(): Promise<void>;
    onChange(listener: (state: UpdateState) => void): () => void;
  };
}
