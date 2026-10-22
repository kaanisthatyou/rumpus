// Connectors' secrets are sealed and opened here with safeStorage, for the core, which keeps only the sealed text
// in `<app>/connectors.json` (PLAN.md 5.9). Nothing is stored in the clear: without an OS secret store the core is
// told so and refuses secrets.
import type { UtilityProcess } from 'electron';
import { cipher } from './providers.js';

const MAX = 64 * 1024;

/** Serves the core's seal and unseal requests; called again for each new core process. */
export function attachSecrets(core: UtilityProcess): void {
  const protection = cipher.protection();
  core.postMessage({ type: 'secrets', value: protection });
  core.on('message', (raw: unknown) => {
    const m = raw as { type?: string; id?: number; value?: unknown };
    if ((m?.type !== 'seal' && m?.type !== 'unseal') || typeof m.id !== 'number') return;
    if (typeof m.value !== 'string' || m.value.length > MAX || protection === 'none') {
      core.postMessage({ type: 'sealed', id: m.id, error: 'refused' });
      return;
    }
    try {
      const value = m.type === 'seal' ? cipher.encrypt(m.value) : cipher.decrypt(m.value);
      core.postMessage({ type: 'sealed', id: m.id, value });
    } catch {
      core.postMessage({ type: 'sealed', id: m.id, error: 'failed' });
    }
  });
}
