// A walk through every page of the real app at several window sizes, for looking at layouts: no assertions beyond
// "the page opened". The fake Claude Code is first on PATH, so the pages have something on them (an agent, a job,
// a card, an idea). Screenshots land in test-results/tour-<width>-<page>.png.
// Usage: node e2e/tour.mjs   (after electron-vite build; TOUR_SIZES=960x640,1280x820 to choose the sizes,
//                             TOUR_LANG=en for English, TOUR_THEME=light for the light theme)
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { locale } from './locale.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const electronPath = createRequire(import.meta.url)('electron');
const lang = process.env.TOUR_LANG === 'en' ? 'en' : 'tr';
const L = locale(lang);
const shots = join(appDir, 'test-results');
mkdirSync(shots, { recursive: true });
const sizes = (process.env.TOUR_SIZES ?? '960x640,1280x820,1440x900')
  .split(',')
  .map((s) => s.split('x').map(Number))
  .filter(([w, h]) => w > 0 && h > 0);

const home = mkdtempSync(join(tmpdir(), 'lonca-tour-'));
const project = mkdtempSync(join(tmpdir(), 'lonca-tour-project-'));
writeFileSync(join(project, 'README.md'), '# Fake project\n');
const bin = mkdtempSync(join(tmpdir(), 'lonca-tour-bin-'));
copyFileSync(join(here, 'fake-claude.mjs'), join(bin, 'fake-claude.mjs'));
if (process.platform === 'win32') {
  writeFileSync(
    join(bin, 'claude.cmd'),
    '@ECHO off\r\nSETLOCAL\r\nSET dp0=%~dp0\r\nnode "%dp0%\\fake-claude.mjs" %*\r\n',
  );
} else {
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec node "${join(bin, 'fake-claude.mjs')}" "$@"\n`, { mode: 0o755 });
}
writeFileSync(
  join(home, 'settings.json'),
  JSON.stringify({
    v: 1,
    language: lang,
    theme: process.env.TOUR_THEME === 'light' ? 'light' : 'dark',
    accent: 'lime',
    motion: 'system',
    profile: { name: 'Kaan' },
    dataDir: '',
    onboarded: true,
  }),
);

const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
const app = await electron.launch({
  executablePath: electronPath,
  args: [appDir],
  env: {
    ...process.env,
    [pathKey]: `${bin}${delimiter}${process.env[pathKey]}`,
    LONCA_HOME: home,
    LONCA_LANG: lang,
    LONCA_DESKTOP_DIR: project,
  },
});
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await app.evaluate(({ dialog }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
}, project);

let width = 0;
const shot = async (name) => {
  await page.waitForTimeout(450);
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'),
  );
  writeFileSync(join(shots, `tour-${width}-${name}.png`), Buffer.from(png, 'base64'));
};
const resize = async (w, h) => {
  width = w;
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.unmaximize();
      win.setMinimumSize(320, 320);
      win.setContentSize(size.w, size.h);
    },
    { w, h },
  );
  await page.waitForTimeout(300);
};
/** Things a page may not have (a button that moved, a renamed label) must not end the walk. */
const tryTo = async (what, fn) => {
  try {
    await fn();
  } catch (e) {
    console.log(`tour: skipped ${what}: ${String(e).split('\n')[0]}`);
    await page.keyboard.press('Escape').catch(() => {});
  }
};
const side = page.getByRole('complementary', { name: L.shell.channels });
const nav = (name) => side.getByRole('button', { name, exact: true }).click({ timeout: 5000 });

try {
  await page.getByRole('button', { name: L.shell.home, exact: true }).first().waitFor();
  // Something to look at: an agent, a job with steps, a board card, an idea, a saved command.
  await tryTo('agent', async () => {
    await page.getByRole('button', { name: L.crew.add, exact: true }).click({ timeout: 5000 });
    await page.getByRole('dialog', { name: L.agentForm.new }).waitFor();
    await page.getByRole('button', { name: L.agentForm.save }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 5000 });
  });
  const composer = page.getByRole('textbox', { name: L.shell.composer.replace('{{channel}}', 'genel') });
  await tryTo('job', async () => {
    await side.getByRole('button', { name: /^genel/ }).click({ timeout: 5000 });
    await composer.fill('Girişe e-posta doğrulaması eklendi, testleri yarın yazılacak.');
    await composer.press('Enter');
    await composer.fill('@claude README dosyasında ne var?');
    await composer.press('Enter');
    await page.getByText(L.job.state.done).first().waitFor({ timeout: 20_000 });
    for (const title of ['README dosyasını güncelle @claude', 'Sürüm notlarını yaz', 'Giriş ekranı testleri']) {
      await composer.fill(`/todo ${title}`);
      await composer.press('Enter');
      await page.waitForTimeout(300);
    }
    const answer = page.locator('.msg--agent').first();
    await answer.hover();
    await answer.getByRole('button', { name: L.records.saveMessage }).click({ timeout: 5000 });
  });

  for (const [w, h] of sizes) {
    await resize(w, h);
    await tryTo('overview', async () => {
      await nav(L.shell.home);
      await shot('overview');
    });
    await tryTo('channel', async () => {
      await side.getByRole('button', { name: /^genel/ }).click({ timeout: 5000 });
      await shot('channel');
    });
    for (const view of ['tasks', 'goals', 'routines', 'ideas', 'references', 'commands', 'memory']) {
      await tryTo(view, async () => {
        await nav(L.shell[view]);
        if (view === 'ideas')
          await page
            .locator('.rec')
            .first()
            .click({ timeout: 3000 })
            .catch(() => {});
        await shot(view);
      });
    }
    await tryTo('palette', async () => {
      await page.keyboard.press('Control+k');
      await page.getByRole('textbox', { name: L.palette.placeholder }).waitFor({ timeout: 3000 });
      await shot('palette');
      await page.keyboard.press('Escape');
    });
    // In a narrow window the crew is a strip: its panel opens over the page.
    const openCrew = async () => {
      if ((await page.locator('.strip').count()) === 0 || (await page.locator('.crew--over').count()) > 0) return;
      await page.getByRole('button', { name: L.shell.expandCrew, exact: true }).click({ timeout: 3000 });
      await page.locator('.crew--over').waitFor({ timeout: 3000 });
    };
    await tryTo('agent form', async () => {
      await nav(L.shell.tasks);
      await openCrew();
      if ((await page.locator('.crew--over').count()) > 0) await shot('crew-over');
      await page.locator('.who').getByRole('button', { name: L.agentForm.edit }).first().click({ timeout: 3000 });
      const form = page.getByRole('dialog', { name: L.agentForm.edit });
      await form.waitFor();
      await shot('agent-form');
      await form.getByRole('button', { name: L.traits.careful.name, exact: true }).click({ timeout: 3000 });
      await form.getByRole('button', { name: L.traits.tests.name, exact: true }).click({ timeout: 3000 });
      await form.getByRole('button', { name: L.traits.tests.name, exact: true }).scrollIntoViewIfNeeded();
      await page.mouse.move(5, 5);
      await shot('agent-form-traits');
      await page.keyboard.press('Escape');
    });
    await tryTo('specialists', async () => {
      await openCrew();
      await page.getByRole('button', { name: L.specialists.new, exact: true }).first().click({ timeout: 3000 });
      await page.getByRole('dialog', { name: L.specialists.new }).waitFor();
      await shot('specialist-gallery');
      await page.keyboard.press('Escape');
    });
    await page.keyboard.press('Escape');
    await tryTo('settings', async () => {
      await page.keyboard.press('Control+Comma');
      const prefs = page.getByRole('dialog', { name: L.settings.title });
      await prefs.waitFor({ timeout: 3000 });
      await shot('settings');
      for (const tab of ['appearance', 'agents', 'instructions', 'shortcuts']) {
        await prefs.getByRole('button', { name: L.settings.tabs[tab] }).click({ timeout: 3000 });
        await shot(`settings-${tab}`);
      }
      await page.keyboard.press('Escape');
    });
  }
  if (errors.length > 0) console.log(`tour: page errors:\n${errors.join('\n')}`);
  console.log(`tour ok: ${sizes.map(([w, h]) => `${w}x${h}`).join(', ')}`);
} finally {
  await app.close().catch(() => {});
  for (const dir of [home, project, bin]) rmSync(dir, { recursive: true, force: true });
}
