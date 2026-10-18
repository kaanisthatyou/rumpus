// The phone companion in the real app, over loopback instead of tailscale serve: the desktop turns phones on and
// shows a pairing link; a narrow window with its own cookie jar plays the phone, pairs, and writes a message that the
// desktop shows. A second "phone" without pairing sees how to pair; revoking cuts the first one off.
// Usage: node e2e/phone.mjs   (after electron-vite build; E2E_EXE=release/win-unpacked/Lonca.exe for packaged)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const electronPath = createRequire(import.meta.url)('electron');
const L = JSON.parse(readFileSync(join(appDir, 'src/renderer/src/locales/tr.json'), 'utf8'));
const shots = join(appDir, 'test-results');
mkdirSync(shots, { recursive: true });
const home = mkdtempSync(join(tmpdir(), 'lonca-e2e-phone-'));
writeFileSync(
  join(home, 'settings.json'),
  JSON.stringify({
    v: 1,
    language: 'tr',
    theme: 'dark',
    accent: 'lime',
    motion: 'system',
    profile: { name: 'Kaan' },
    dataDir: '',
    onboarded: true,
  }),
);

const packaged = process.env.E2E_EXE ? join(appDir, process.env.E2E_EXE) : undefined;
const app = await electron.launch({
  executablePath: packaged ?? electronPath,
  args: packaged ? [] : [appDir],
  env: { ...process.env, LONCA_HOME: home, LONCA_LANG: 'tr', LONCA_PHONE_PORT: '0' },
});
const errors = [];
const desk = await app.firstWindow();
desk.on('pageerror', (e) => errors.push(String(e)));
const shot = async (page, name) => {
  await page.waitForTimeout(400);
  const png = await page.screenshot({ timeout: 10_000 }).catch(() => undefined);
  if (png) writeFileSync(join(shots, `phone-${name}.png`), png);
};

/** Opens a window that plays a phone: narrow, no preload, its own cookies. */
async function phone(url, partition) {
  const before = app.windows().length;
  await app.evaluate(
    ({ BrowserWindow }, { url, partition }) => {
      const w = new BrowserWindow({ width: 390, height: 844, webPreferences: { partition, sandbox: true } });
      void w.loadURL(url);
    },
    { url, partition },
  );
  for (let i = 0; i < 100 && app.windows().length === before; i++) await new Promise((r) => setTimeout(r, 100));
  const page = app.windows().at(-1);
  page.on('pageerror', (e) => errors.push(`phone: ${String(e)}`));
  return page;
}

try {
  await desk.getByRole('heading', { name: L.shell.crew }).waitFor();
  await desk.keyboard.press('Control+Comma');
  const prefs = desk.getByRole('dialog', { name: L.settings.title });
  await prefs.getByRole('button', { name: L.settings.tabs.phone }).click();
  await prefs.getByRole('switch', { name: L.phone.on }).click();
  await prefs.getByRole('button', { name: L.phone.add }).click();
  const link = await prefs.locator('.phone__url').innerText();
  assert.match(link, /^http:\/\/127\.0\.0\.1:\d+\/\?pair=[\w-]+$/);
  await prefs.getByRole('img', { name: L.phone.qr }).waitFor();
  await shot(desk, 'settings');

  // The phone pairs through the link and gets the app, laid out for a narrow screen.
  const p = await phone(link, 'persist:phone-a');
  await p.getByRole('navigation', { name: L.phone.bar }).waitFor();
  await p.getByRole('button', { name: L.shell.channels }).click();
  await p.getByRole('button', { name: 'genel', exact: true }).click();
  const box = p.getByRole('textbox', { name: 'Mesaj · #genel' });
  await box.fill('Telefondan selam');
  await box.press('Enter');
  await desk.keyboard.press('Escape');
  await desk.getByRole('button', { name: 'genel', exact: true }).click();
  await desk.locator('.msg', { hasText: 'Telefondan selam' }).waitFor({ timeout: 15_000 });
  await p.locator('.msg', { hasText: 'Telefondan selam' }).waitFor();
  await shot(p, 'chat');

  // Another browser without pairing sees how to pair.
  const base = new URL(link).origin;
  const stranger = await phone(`${base}/`, 'persist:phone-b');
  await stranger.getByRole('heading', { name: L.phone.unpaired.title }).waitFor();

  // Revoking the phone cuts it off.
  await desk.keyboard.press('Control+Comma');
  await prefs.getByRole('button', { name: L.settings.tabs.phone }).click();
  const list = prefs.getByRole('list', { name: L.phone.list });
  await list.getByRole('button', { name: /eşleşmesini kaldır/ }).click();
  await list.waitFor({ state: 'detached' });
  const status = await p.evaluate(
    async () =>
      (
        await fetch('/api/frame', {
          method: 'POST',
          headers: { 'x-lonca': '1' },
          body: '{"id":1,"method":"settings.get"}',
        })
      ).status,
  );
  assert.equal(status, 401);
  assert.deepEqual(errors, []);
  console.log('phone e2e ok');
} finally {
  await app.close().catch(() => {});
  rmSync(home, { recursive: true, force: true });
}
