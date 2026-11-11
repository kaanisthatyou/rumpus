// The same UI on a paired phone (PLAN.md 5.12): no Electron, so the bridge's main-process functions become their
// browser versions or nothing, and the core is reached over HTTP on the PC. Everything still runs on the PC.
import type { LoncaBridge, UpdateState } from '../../shared/bridge';
import { core } from './rpc';

const KEY = 'lonca.phone';

function storedKey(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sets up the phone mode when there is no Electron bridge. Returns `ready` once the core answers, `unpaired` when
 * this phone has no key (the page then shows how to pair), or `desktop` in the app itself.
 */
export async function startWeb(): Promise<'desktop' | 'ready' | 'unpaired'> {
  if (window.lonca) return 'desktop';
  document.documentElement.dataset.phone = '1';
  const url = new URL(window.location.href);
  let token = storedKey();
  const pair = url.searchParams.get('pair');
  if (pair) {
    const res = await fetch('/api/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lonca': '1' },
      body: JSON.stringify({ code: pair, name: phoneName() }),
    }).catch(() => undefined);
    if (res?.ok) {
      token = ((await res.json()) as { token: string }).token;
      try {
        localStorage.setItem(KEY, token);
      } catch {
        // the cookie still works
      }
    }
    url.searchParams.delete('pair');
    window.history.replaceState(null, '', url.pathname + url.search);
  }
  window.lonca = webBridge();
  const ok = await fetch('/api/frame', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lonca': '1', ...(token ? { 'x-lonca-phone': token } : {}) },
    body: JSON.stringify({ id: 0, method: 'settings.get' }),
  })
    .then((r) => r.ok)
    .catch(() => false);
  if (!ok) return 'unpaired';
  core.connectHttp(token);
  navigator.serviceWorker?.register('/sw.js').catch(() => {});
  return 'ready';
}

/** Whether this phone can get pushes, and whether it already allowed them. */
export function pushState(): 'unsupported' | 'off' | 'on' | 'blocked' {
  if (
    !window.isSecureContext ||
    !('serviceWorker' in navigator) ||
    typeof Notification === 'undefined' ||
    !('PushManager' in window)
  )
    return 'unsupported';
  return Notification.permission === 'granted' ? 'on' : Notification.permission === 'denied' ? 'blocked' : 'off';
}

/** Asks for notifications (from a tap) and hands the subscription to the PC. */
export async function enablePush(): Promise<boolean> {
  if (pushState() === 'unsupported') return false;
  if ((await Notification.requestPermission()) !== 'granted') return false;
  const token = storedKey();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-lonca': '1',
    ...(token ? { 'x-lonca-phone': token } : {}),
  };
  const { key } = (await (await fetch('/api/push-key', { headers })).json()) as { key: string };
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
  });
  const res = await fetch('/api/push', {
    method: 'POST',
    headers,
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  return res.ok;
}

function phoneName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  const android = /Android[^;]*;\s*([^;)]+)/.exec(ua)?.[1];
  return android?.trim().slice(0, 40) || 'Telefon';
}

/** What the Electron bridge does, as far as a browser on a phone can. */
function webBridge(): LoncaBridge {
  const disabled: UpdateState = { status: 'disabled' };
  return {
    shell: {
      pickFolder: async () => null,
      openExternal: async (url) => {
        if (/^https:\/\//.test(url)) window.open(url, '_blank', 'noopener');
      },
      openFolder: async () => {},
      copy: async (text) => {
        await navigator.clipboard?.writeText(text).catch(() => {});
      },
      appInfo: async () => ({ version: '', platform: 'web', packaged: true }),
      setTitleBar: async () => {},
      // A phone has its own text size (the browser's and the system's).
      setZoom: async () => {},
      notify: async (title, body) => {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted')
          new Notification(title, { body });
      },
    },
    // Invite links open the PC's app, never a phone's page.
    links: { pending: async () => null, onJoin: () => () => {} },
    // The quick-entry window is the PC's own.
    quick: { open: async () => {}, hide: async () => {}, setKey: async () => true },
    providers: {
      // Keys stay on the PC's main process: providers are managed there.
      state: async () => ({ providers: [], protection: 'none' }),
      save: async () => {
        throw new Error('Error: not_allowed');
      },
      remove: async () => {},
      removeKey: async () => {
        throw new Error('Error: not_allowed');
      },
      models: async () => {
        throw new Error('Error: not_allowed');
      },
      onChange: () => () => {},
    },
    updates: {
      state: async () => disabled,
      check: async () => disabled,
      install: async () => {},
      onChange: () => () => {},
    },
  };
}
