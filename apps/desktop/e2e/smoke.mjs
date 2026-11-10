// End-to-end smoke test of the real app: a fresh data folder, the whole launcher, the shell, settings,
// and a restart that must skip the launcher. Screenshots land in test-results/.
// Usage: pnpm e2e   (E2E_LANG=en for English, E2E_KEEP=1 to keep the data folder,
//                   E2E_EXE=release/win-unpacked/Serai.exe to test the packaged app)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { locale } from './locale.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const electronPath = createRequire(import.meta.url)('electron');
const lang = process.env.E2E_LANG === 'en' ? 'en' : 'tr';
const L = locale(lang);
const home = mkdtempSync(join(tmpdir(), 'lonca-e2e-'));
const shots = join(appDir, 'test-results');
mkdirSync(shots, { recursive: true });

async function launch() {
  const packaged = process.env.E2E_EXE ? join(appDir, process.env.E2E_EXE) : undefined;
  const app = await electron.launch({
    executablePath: packaged ?? electronPath,
    args: packaged ? [] : [appDir],
    env: { ...process.env, LONCA_HOME: home, LONCA_LANG: lang, ELECTRON_RENDERER_URL: '' },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { app, page, errors };
}

let n = 0;
let current;
// Playwright's page.screenshot can hang on Electron windows; Electron's own capture does not.
const shot = async (page, name) => {
  await page.waitForTimeout(700);
  n += 1;
  const png = await current.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
    return image.toPNG().toString('base64');
  });
  writeFileSync(join(shots, `${lang}-${String(n).padStart(2, '0')}-${name}.png`), Buffer.from(png, 'base64'));
};

const { app, page, errors } = await launch();
current = app;
const visible = async (a) => {
  for (let i = 0; i < 50; i++) {
    if (await a.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() === true)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};
try {
  const next = () => page.getByRole('button', { name: L.common.continue, exact: true }).click();
  // Radios are visually hidden inside their labels: click the label, as a person does, then check the state.
  const choose = async (name) => {
    const radio = page.getByRole('radio', { name, exact: true });
    await page.locator('label').filter({ has: radio }).click();
    for (let i = 0; i < 20 && !(await radio.isChecked()); i++) await page.waitForTimeout(50);
    assert.equal(await radio.isChecked(), true, `${name} is not selected`);
  };

  await page.getByRole('heading', { name: L.launcher.steps.language }).waitFor();
  assert.equal(await visible(app), true, 'the window was never shown');
  await choose(lang === 'tr' ? 'Türkçe' : 'English');
  await shot(page, 'language');
  await next();

  await page.getByRole('heading', { name: L.launcher.steps.appearance }).waitFor();
  await shot(page, 'appearance');
  await next();

  await page.getByRole('heading', { name: L.launcher.steps.profile }).waitFor();
  await next();
  await page.getByText(L.launcher.profile.required).waitFor();
  await page.getByLabel(L.launcher.profile.name).fill('Kaan');
  await shot(page, 'profile');
  await next();

  await page.getByRole('heading', { name: L.launcher.steps.data }).waitFor();
  await page.getByText(home, { exact: false }).waitFor();
  await shot(page, 'data');
  await next();

  await page.getByRole('heading', { name: L.launcher.steps.agents }).waitFor();
  await page.getByRole('button', { name: L.common.rescan }).waitFor({ timeout: 30_000 });
  await shot(page, 'agents');
  await next();

  await page.getByRole('heading', { name: L.launcher.steps.team }).waitFor();
  await shot(page, 'team');
  await page.getByRole('button', { name: L.common.finish }).click();

  await page.getByRole('heading', { name: L.shell.crew }).waitFor();
  await shot(page, 'shell');
  await page.getByRole('button', { name: L.shell.tasks }).click();
  await shot(page, 'tasks');

  await page.keyboard.press('Control+Comma');
  await page.getByRole('dialog', { name: L.settings.title }).waitFor();
  await shot(page, 'settings');
  await page.getByRole('button', { name: L.settings.tabs.appearance }).click();
  await choose(L.theme.light);
  await shot(page, 'settings-light');
  await choose(L.accent.blue);
  await page.keyboard.press('Escape');
  await shot(page, 'shell-light');

  const saved = JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8'));
  assert.equal(saved.onboarded, true);
  assert.equal(saved.profile.name, 'Kaan');
  assert.equal(saved.theme, 'light');
  assert.equal(saved.accent, 'blue');
  assert.deepEqual(errors, [], `page errors: ${errors.join('\n')}`);
} finally {
  await app.close();
}

// A restart goes straight to the shell.
const second = await launch();
current = second.app;
try {
  await second.page.getByRole('heading', { name: L.shell.crew }).waitFor();
  assert.equal(await second.page.getByRole('heading', { name: L.launcher.steps.language }).count(), 0);
  await shot(second.page, 'restart');

  // A team lonca next to the personal one: its own channels; switching back finds the personal one as it was.
  const p = second.page;
  const genel = L.shell.defaultChannel;
  await p.getByRole('button', { name: genel, exact: true }).click();
  await p.getByRole('textbox', { name: L.shell.composer.replace('{{channel}}', genel) }).fill('kişisel not');
  await p.getByRole('textbox', { name: L.shell.composer.replace('{{channel}}', genel) }).press('Enter');
  await p.locator('.msg', { hasText: 'kişisel not' }).waitFor();
  await p.getByRole('button', { name: L.shell.newWorkspace }).click();
  const dialog = p.getByRole('dialog', { name: L.shell.newWorkspace });
  await dialog.getByLabel(L.workspaces.name, { exact: true }).fill('Ekip');
  await dialog.getByRole('button', { name: L.workspaces.create }).click();
  await p.getByRole('heading', { name: 'Ekip', exact: true }).waitFor();
  await p.getByText(L.shell.teamStorage).waitFor();
  assert.equal(await p.locator('.msg', { hasText: 'kişisel not' }).count(), 0);
  await shot(p, 'team-lonca');
  await p.getByRole('button', { name: L.shell.workspace, exact: true }).click();
  await p.locator('.msg', { hasText: 'kişisel not' }).waitFor();
  await p.getByRole('button', { name: 'Ekip', exact: true }).waitFor();
  assert.deepEqual(second.errors, []);
} finally {
  await second.app.close();
}

if (process.env.E2E_KEEP !== '1') rmSync(home, { recursive: true, force: true });
console.log(`e2e ok (${lang}), ${n} screenshots in ${shots}`);
