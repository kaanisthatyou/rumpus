import type { ProvidersState } from '@lonca/protocol';
import { contextBridge, ipcRenderer } from 'electron';
import type { LoncaBridge, UpdateState } from '../shared/bridge.js';

// The core's port arrives here; it is handed to the page, which talks to the core directly.
ipcRenderer.on('lonca:port', (event) => {
  window.postMessage({ lonca: 'port' }, window.location.origin === 'null' ? '*' : window.location.origin, event.ports);
});

const bridge: LoncaBridge = {
  shell: {
    pickFolder: () => ipcRenderer.invoke('shell:pickFolder'),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    openFolder: (path) => ipcRenderer.invoke('shell:openFolder', path),
    copy: (text) => ipcRenderer.invoke('shell:copy', text),
    appInfo: () => ipcRenderer.invoke('shell:appInfo'),
    setTitleBar: (colors) => ipcRenderer.invoke('shell:setTitleBar', colors),
    notify: (title, body) => ipcRenderer.invoke('shell:notify', title, body),
  },
  links: {
    pending: () => ipcRenderer.invoke('link:pending'),
    onJoin: (listener) => {
      const h = (_e: unknown, link: string) => listener(link);
      ipcRenderer.on('link:join', h);
      return () => ipcRenderer.off('link:join', h);
    },
  },
  quick: {
    open: () => ipcRenderer.invoke('quick:open'),
    hide: () => ipcRenderer.invoke('quick:hide'),
    setKey: (combo) => ipcRenderer.invoke('quick:setKey', combo),
  },
  providers: {
    state: () => ipcRenderer.invoke('providers:state'),
    save: (input) => ipcRenderer.invoke('providers:save', input),
    remove: (id) => ipcRenderer.invoke('providers:remove', id),
    removeKey: (id, keyId) => ipcRenderer.invoke('providers:removeKey', id, keyId),
    models: (id) => ipcRenderer.invoke('providers:models', id),
    onChange: (listener) => {
      const h = (_e: unknown, state: ProvidersState) => listener(state);
      ipcRenderer.on('providers:changed', h);
      return () => ipcRenderer.off('providers:changed', h);
    },
  },
  updates: {
    state: () => ipcRenderer.invoke('update:state'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onChange: (listener) => {
      const h = (_e: unknown, state: UpdateState) => listener(state);
      ipcRenderer.on('update:changed', h);
      return () => ipcRenderer.off('update:changed', h);
    },
  },
};

contextBridge.exposeInMainWorld('lonca', bridge);
