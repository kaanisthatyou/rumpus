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
    /** An OS notification; clicking it brings Rumpus forward. */
    notify(title: string, body: string): Promise<void>;
  };
  /** Invite links (`rumpus://join/<code>`) the app was opened with. */
  links: {
    /** A link that arrived before the page was ready; it is handed out once. */
    pending(): Promise<string | null>;
    onJoin(listener: (link: string) => void): () => void;
  };
  /** The quick-entry window (Ctrl Alt Space from anywhere). */
  quick: {
    open(): Promise<void>;
    hide(): Promise<void>;
    /** Registers the global key (`Ctrl+Alt+Space`); false when another app holds it (the old key stays). */
    setKey(combo: string): Promise<boolean>;
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
