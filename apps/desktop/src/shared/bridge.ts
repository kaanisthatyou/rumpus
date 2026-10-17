import type { Platform } from '@lonca/protocol';

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
    copy(text: string): Promise<void>;
    appInfo(): Promise<AppInfo>;
    setTitleBar(colors: { background: string; symbols: string }): Promise<void>;
    /** An OS notification; clicking it brings Lonca forward. */
    notify(title: string, body: string): Promise<void>;
  };
  updates: {
    state(): Promise<UpdateState>;
    check(): Promise<UpdateState>;
    install(): Promise<void>;
    onChange(listener: (state: UpdateState) => void): () => void;
  };
}
