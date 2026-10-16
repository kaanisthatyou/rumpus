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
    copy: (text) => ipcRenderer.invoke('shell:copy', text),
    appInfo: () => ipcRenderer.invoke('shell:appInfo'),
    setTitleBar: (colors) => ipcRenderer.invoke('shell:setTitleBar', colors),
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
