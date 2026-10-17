// End-to-end test of providers and advisors in the real app, against a fake OpenAI-compatible server
// (fake-provider.mjs): add a provider with a wrong key and then the right one, fetch its models, restart and find
// it again with the key sealed on disk.
// Usage: node e2e/advisors.mjs   (after electron-vite build; E2E_EXE=release/win-unpacked/Lonca.exe for packaged)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { startFakeProvider } from './fake-provider.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const electronPath = createRequire(import.meta.url)('electron');
const L = JSON.parse(readFileSync(join(appDir, 'src/renderer/src/locales/tr.json'), 'utf8'));
const shots = join(appDir, 'test-results');
mkdirSync(shots, { recursive: true });

const home = mkdtempSync(join(tmpdir(), 'lonca-e2e-adv-'));
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
const provider = await startFakeProvider();

let n = 0;
let current;
const shot = async (page, name) => {
  await page.waitForTimeout(500);
  n += 1;
  const png = await current.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'),
  );
  writeFileSync(join(shots, `adv-${String(n).padStart(2, '0')}-${name}.png`), Buffer.from(png, 'base64'));
};

async function launch() {
  const packaged = process.env.E2E_EXE ? join(appDir, process.env.E2E_EXE) : undefined;
  const app = await electron.launch({
    executablePath: packaged ?? electronPath,
    args: packaged ? [] : [appDir],
    env: { ...process.env, LONCA_HOME: home, LONCA_LANG: 'tr' },
  });
  current = app;
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { app, page, errors };
}

const openProviders = async (page) => {
  await page.keyboard.press('Control+Comma');
  const prefs = page.getByRole('dialog', { name: L.settings.title });
  await prefs.getByRole('button', { name: L.settings.tabs.providers }).click();
  return prefs;
};

let run = await launch();
try {
  let { page } = run;
  await page.getByRole('heading', { name: L.shell.crew }).waitFor();

  // A provider with a wrong key: saved, but the model list is refused.
  let prefs = await openProviders(page);
  await prefs.getByText(L.providers.empty).waitFor();
  await prefs.getByRole('button', { name: L.providers.add }).click();
  await prefs.getByRole('button', { name: new RegExp(L.providers.custom) }).click();
  await prefs.getByLabel(L.providers.name, { exact: true }).fill('Test sağlayıcı');
  await prefs.getByLabel(L.providers.baseUrl, { exact: true }).fill('http://example.com/v1');
  await prefs.getByText(L.errors.provider_bad_url).first().waitFor();
  await prefs.getByLabel(L.providers.baseUrl, { exact: true }).fill(provider.url);
  await prefs.getByLabel(L.providers.key, { exact: true }).fill('sk-test-wrong');
  await prefs.getByRole('button', { name: L.providers.save }).click();
  await page.getByText(L.errors.provider_auth).waitFor();
  const row = prefs.getByRole('listitem', { name: 'Test sağlayıcı' });
  await row.getByText('···rong').waitFor();
  await row.getByText(L.providers.noModels).waitFor();

  // The right key goes after the wrong one; the chain finds it.
  await row.getByRole('button', { name: L.providers.edit }).click();
  await prefs.getByLabel(L.providers.keyAdd, { exact: true }).fill('sk-test-good');
  await prefs.getByRole('button', { name: L.providers.save }).click();
  await row.getByText('2 model').waitFor();
  await row.getByText('···good').waitFor();
  await shot(page, 'providers');

  // The wrong key comes off the chain.
  await row.getByRole('button', { name: L.providers.removeKey.replace('{{hint}}', 'rong') }).click();
  await until(async () => (await row.getByText('···rong').count()) === 0, 'key removed');
  await page.keyboard.press('Escape');
  assert.deepEqual(run.errors, []);
  await run.app.close();

  // On disk: no key in the clear.
  const stored = readFileSync(join(home, 'providers.json'), 'utf8');
  assert.ok(!stored.includes('sk-test-good'), 'key stored in the clear');
  assert.ok(stored.includes('Test sağlayıcı'));

  run = await launch();
  page = run.page;
  await page.getByRole('heading', { name: L.shell.crew }).waitFor();
  prefs = await openProviders(page);
  const again = prefs.getByRole('listitem', { name: 'Test sağlayıcı' });
  await again.getByText('2 model').waitFor();
  await again.getByRole('button', { name: L.providers.fetch }).click();
  await page.getByText(L.providers.fetched.replace('{{count}}', '2')).waitFor();
  await page.keyboard.press('Escape');
  assert.deepEqual(run.errors, []);
  console.log(`advisors e2e ok, ${n} screenshots in ${shots}`);
} finally {
  await run.app.close().catch(() => {});
  await provider.close();
  rmSync(home, { recursive: true, force: true });
}

async function until(fn, what, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out: ${what}`);
}
