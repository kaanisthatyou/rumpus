// End-to-end test of the adaptive shell and the personal settings in the real app, with the fake Claude Code
// first on PATH: an agent added without picking a folder (it works in the default one) with character presets
// that reach its prompt; the look settings (accent, density, time format, text size); a narrow window where the
// crew is a strip and its panel opens over the page; the channel list hidden and shown; all of it after a restart.
// Usage: node e2e/layout.mjs   (after electron-vite build; E2E_EXE=release/win-unpacked/<name>.exe for packaged)
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { locale } from './locale.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const electronPath = createRequire(import.meta.url)('electron');
const L = locale('tr');
const shots = join(appDir, 'test-results');
mkdirSync(shots, { recursive: true });

const home = mkdtempSync(join(tmpdir(), 'lonca-e2e-layout-'));
// Stands in for the desktop: where an agent works when no folder is picked.
const desktop = mkdtempSync(join(tmpdir(), 'lonca-e2e-desktop-'));
const other = mkdtempSync(join(tmpdir(), 'lonca-e2e-other-'));
const bin = mkdtempSync(join(tmpdir(), 'lonca-e2e-layout-bin-'));
copyFileSync(join(here, 'fake-claude.mjs'), join(bin, 'fake-claude.mjs'));
if (process.platform === 'win32') {
  writeFileSync(
    join(bin, 'claude.cmd'),
    '@ECHO off\r\nSETLOCAL\r\nSET dp0=%~dp0\r\nnode "%dp0%\\fake-claude.mjs" %*\r\n',
  );
} else {
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec node "${join(bin, 'fake-claude.mjs')}" "$@"\n`, { mode: 0o755 });
}
// Settings from before the look options: they get their defaults.
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

let n = 0;
let current;
const shot = async (page, name) => {
  await page.waitForTimeout(450);
  n += 1;
  const png = await current.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'),
  );
  writeFileSync(join(shots, `lay-${String(n).padStart(2, '0')}-${name}.png`), Buffer.from(png, 'base64'));
};

async function launch() {
  const packaged = process.env.E2E_EXE ? join(appDir, process.env.E2E_EXE) : undefined;
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const app = await electron.launch({
    executablePath: packaged ?? electronPath,
    args: packaged ? [] : [appDir],
    env: {
      ...process.env,
      [pathKey]: `${bin}${delimiter}${process.env[pathKey]}`,
      LONCA_HOME: home,
      LONCA_LANG: 'tr',
      LONCA_DESKTOP_DIR: desktop,
    },
  });
  current = app;
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, other);
  return { app, page, errors };
}

const resize = async (app, page, width, height) => {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.unmaximize();
      win.setContentSize(size.width, size.height);
    },
    { width, height },
  );
  await page.waitForTimeout(350);
};
const zoomOf = (app) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
const until = async (fn, what, ms = 10_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out: ${what}`);
};
/** Nothing on the page runs out of the window sideways. */
const fits = async (page, what) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.equal(over <= 0, true, `${what}: the page is ${over}px wider than the window`);
};

const first = await launch();
let { app, page, errors } = first;
try {
  await resize(app, page, 1440, 900);
  const side = page.getByRole('complementary', { name: L.shell.channels });
  await side.getByRole('button', { name: L.shell.home, exact: true }).waitFor();
  const crew = page.locator('aside.crew');
  await crew.waitFor();

  // An agent without a picked folder: the form shows the default one and saving needs nothing more.
  await page.getByRole('button', { name: L.crew.add, exact: true }).click();
  const form = page.getByRole('dialog', { name: L.agentForm.new });
  await form.getByText(desktop).waitFor();
  await form.getByText(L.agentForm.folderDefault, { exact: true }).waitFor();
  // Character presets: picking one drops its opposite.
  const trait = (id) => form.getByRole('button', { name: L.traits[id].name, exact: true });
  await trait('fast').click();
  await trait('careful').click();
  await trait('tests').click();
  assert.equal(await trait('fast').getAttribute('aria-pressed'), 'false');
  assert.equal(await trait('careful').getAttribute('aria-pressed'), 'true');
  await form.getByText(L.traits.tests.hint).waitFor();
  await shot(page, 'agent-form');
  await form.getByRole('button', { name: L.agentForm.save }).click();
  await form.waitFor({ state: 'detached' });
  await crew.getByText('@claude').waitFor();

  // It runs in the default folder, and the presets are in its prompt.
  await side.getByRole('button', { name: /^@claude/ }).click();
  await page.locator('.chat__topic', { hasText: desktop }).waitFor();
  await page.keyboard.press('Control+Comma');
  const prefs = page.getByRole('dialog', { name: L.settings.title });
  await prefs.getByRole('button', { name: L.settings.tabs.instructions }).click();
  const preview = prefs.locator('pre.instructions__core').last();
  await until(async () => (await preview.innerText()).includes('- Thorough.'), 'the presets in the prompt preview');
  assert.equal((await preview.innerText()).includes('- Test-minded.'), true);
  assert.equal((await preview.innerText()).includes('- Quick.'), false);

  // The default folder for agents is a setting; the form of a new agent follows it.
  await prefs.getByRole('button', { name: L.settings.tabs.general }).click();
  const folderSet = prefs.locator('.set', { hasText: L.settings.agentFolder });
  await folderSet.getByText(desktop).waitFor();
  await folderSet.getByText(L.settings.agentFolderDesktop, { exact: true }).waitFor();
  await folderSet.getByRole('button', { name: L.common.change }).click();
  await folderSet.getByText(other).waitFor();
  await shot(page, 'settings-general');

  // The look: accent, density, time format, text size (the window's zoom).
  await prefs.getByRole('button', { name: L.settings.tabs.appearance }).click();
  const choose = async (name) => {
    // Radios are visually hidden inside their labels: click the label, as a person does.
    const radio = page.getByRole('radio', { name, exact: true });
    await page.locator('label').filter({ has: radio }).click();
    await until(() => radio.isChecked(), `${name} selected`);
  };
  await choose(L.accent.teal);
  await choose(L.settings.densities.compact);
  await choose(L.settings.clocks[12]);
  await choose(L.settings.textSizes.large);
  await until(async () => Math.abs((await zoomOf(app)) - 1.12) < 0.01, 'the window zoomed to the large text size');
  await shot(page, 'settings-look');
  await choose(L.settings.textSizes.normal);
  await until(async () => Math.abs((await zoomOf(app)) - 1) < 0.01, 'the zoom back to normal');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.density), 'compact');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.accent), 'teal');
  await page.keyboard.press('Escape');
  await prefs.waitFor({ state: 'detached' });

  // A message's time in the 12-hour format.
  await side.getByRole('button', { name: /^genel/ }).click();
  const composer = page.getByRole('textbox', { name: 'Mesaj · #genel' });
  await composer.fill('Saat biçimi denemesi');
  await composer.press('Enter');
  const sent = page.locator('.msg', { hasText: 'Saat biçimi denemesi' });
  await sent.waitFor();
  assert.match(await sent.locator('time').first().innerText(), /^\d{1,2}:\d\d (ÖÖ|ÖS)$/);

  // A new agent's form now names the folder from Settings.
  await crew.getByRole('button', { name: L.crew.addAgent, exact: true }).click();
  const second = page.getByRole('dialog', { name: L.agentForm.new });
  await second.getByText(other).waitFor();
  await second.getByRole('button', { name: L.agentForm.cancel }).click();
  await second.waitFor({ state: 'detached' });

  // The board in a wide window: four columns side by side, nothing cut off.
  await composer.fill('/todo Sürüm notlarını yaz');
  await composer.press('Enter');
  await page.getByText(L.board.added).waitFor();
  await side.getByRole('button', { name: L.shell.tasks, exact: true }).click();
  const cols = page.locator('.board__cols');
  await cols.waitFor();
  assert.equal(await cols.evaluate((el) => el.scrollWidth <= el.clientWidth), true, 'the wide board scrolls');
  await shot(page, 'board-wide');

  // A narrow window: the crew becomes a strip, the board keeps readable columns and scrolls sideways.
  await resize(app, page, 960, 640);
  const strip = page.locator('aside.strip');
  await strip.waitFor();
  assert.equal(await crew.count(), 0);
  await strip.getByRole('button', { name: /^Claude · / }).waitFor();
  await fits(page, 'the narrow board');
  const widths = await page.locator('.col').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  assert.equal(Math.min(...widths) >= 200, true, `board columns are ${widths.join(', ')} wide`);
  assert.equal(await cols.evaluate((el) => el.scrollWidth > el.clientWidth), true, 'the narrow board does not scroll');
  await shot(page, 'board-narrow');

  // The panel opens over the page from the strip and closes on Escape; an agent on the strip opens its channel.
  await strip.getByRole('button', { name: L.shell.expandCrew, exact: true }).click();
  const over = page.locator('aside.crew--over');
  await over.getByText('@claude').waitFor();
  await over.getByRole('heading', { name: L.shell.crew }).waitFor();
  await shot(page, 'crew-over');
  await page.keyboard.press('Escape');
  await over.waitFor({ state: 'detached' });
  await strip.getByRole('button', { name: /^Claude · / }).click();
  await page.getByRole('textbox', { name: 'Mesaj · @claude' }).waitFor();
  await fits(page, 'the narrow channel');

  // Records in the narrow window: the list above the record, the status control inside its column.
  await side.getByRole('button', { name: L.shell.ideas, exact: true }).click();
  await page.getByRole('button', { name: L.records.new.idea }).click();
  await page.getByLabel(L.records.title).fill('Dar pencere');
  const status = page.locator('.rec-editor .l-seg').first();
  await status.waitFor();
  const box = await status.boundingBox();
  const editor = await page.locator('.records__editor').boundingBox();
  assert.equal(box.x + box.width <= editor.x + editor.width + 1, true, 'the status control runs out of its column');
  await fits(page, 'the narrow records page');
  await shot(page, 'records-narrow');

  // The channel list hides and comes back (Ctrl B, and the button on the rail); the middle column gets its room.
  await side.getByRole('button', { name: L.shell.home, exact: true }).click();
  const mainWidth = () => page.locator('main.chat').evaluate((el) => el.getBoundingClientRect().width);
  const before = await mainWidth();
  await page.keyboard.press('Control+b');
  await until(async () => (await mainWidth()) > before + 200, 'the page wider with the channel list hidden');
  await until(async () => !(await side.isVisible()), 'the channel list hidden');
  await shot(page, 'sidebar-hidden');
  await page.getByRole('button', { name: L.shell.showSidebar, exact: true }).click();
  await until(async () => Math.abs((await mainWidth()) - before) < 2, 'the channel list back');
  assert.equal(await side.isVisible(), true);

  // Wide again: the panel stands beside the page; narrowed to the strip there, it is a setting that stays.
  await resize(app, page, 1440, 900);
  await crew.waitFor();
  await crew.getByRole('button', { name: L.shell.collapseCrew, exact: true }).click();
  await strip.waitFor();
  await shot(page, 'strip-wide');

  const saved = JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8'));
  assert.deepEqual(
    [saved.accent, saved.density, saved.clock, saved.textSize, saved.crew, saved.sidebar, saved.agentFolder],
    ['teal', 'compact', '12', 'normal', 'strip', true, other],
  );
  assert.deepEqual(errors, [], `page errors: ${errors.join('\n')}`);
} catch (err) {
  await shot(page, 'failed').catch(() => {});
  console.error(errors.join('\n'));
  await app.close().catch(() => {});
  throw err;
}
await app.close();

// After a restart the look and the layout are as they were left.
({ app, page, errors } = await launch());
try {
  await resize(app, page, 1440, 900);
  await page.locator('aside.strip').waitFor();
  assert.equal(await page.locator('aside.crew').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.density), 'compact');
  await page.locator('aside.strip').getByRole('button', { name: L.shell.expandCrew, exact: true }).click();
  await page.locator('aside.crew').getByText('@claude').waitFor();
  await shot(page, 'restart');
  assert.deepEqual(errors, [], `page errors: ${errors.join('\n')}`);
  console.log('layout e2e ok');
} catch (err) {
  await shot(page, 'failed').catch(() => {});
  console.error(errors.join('\n'));
  throw err;
} finally {
  await app.close().catch(() => {});
  for (const dir of [home, desktop, other, bin]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // a still-open handle on Windows: the temp folder is cleaned up by the OS later
    }
  }
}
