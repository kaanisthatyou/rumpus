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
    copy(text: string): Promise<void>;
    appInfo(): Promise<AppInfo>;
    setTitleBar(colors: { background: string; symbols: string }): Promise<void>;
    /** An OS notification; clicking it brings Lonca forward. */
    notify(title: string, body: string): Promise<void>;
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
