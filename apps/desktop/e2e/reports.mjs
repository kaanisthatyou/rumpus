// End-to-end test of reports (PLAN.md 5.21) in the real app, with the fake Claude Code first on PATH: the board's
// Reports page, a routine aimed at it run now; Bub's toast and the unread count; the agent's answer and the report
// it posted are cards with images; a pin; a card opens the report and its image full size; answering it opens the
// agent's channel with the report attached, and the agent gets it; the posted report's questions are decided from
// it; the overview's dashboard.
// Usage: node e2e/reports.mjs   (after electron-vite build)
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

const home = mkdtempSync(join(tmpdir(), 'lonca-e2e-rep-'));
const project = mkdtempSync(join(tmpdir(), 'lonca-e2e-rep-project-'));
writeFileSync(join(project, 'README.md'), '# Fake project\n');
const bin = mkdtempSync(join(tmpdir(), 'lonca-e2e-rep-bin-'));
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
const shot = async (_page, name) => {
  await new Promise((r) => setTimeout(r, 500));
  n += 1;
  const png = await current.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()
        .find((w) => !w.webContents.getURL().endsWith('#toast'))
        .webContents.capturePage()
    )
      .toPNG()
      .toString('base64'),
  );
  writeFileSync(join(shots, `rep-${String(n).padStart(2, '0')}-${name}.png`), Buffer.from(png, 'base64'));
};

const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
const app = await electron.launch({
  executablePath: electronPath,
  args: [appDir],
  env: { ...process.env, [pathKey]: `${bin}${delimiter}${process.env[pathKey]}`, LONCA_HOME: home, LONCA_LANG: 'tr' },
});
current = app;
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await app.evaluate(({ dialog }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
}, project);
await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()
    .find((w) => !w.webContents.getURL().endsWith('#toast'))
    .setSize(1440, 900),
);

try {
  await page.getByRole('heading', { name: L.shell.crew }).waitFor();
  const side = page.getByRole('complementary', { name: L.shell.channels });

  // An agent from the installed (fake) CLI.
  await page.getByRole('button', { name: L.crew.add, exact: true }).click();
  await page.getByRole('dialog', { name: L.agentForm.new }).waitFor();
  await page.getByRole('button', { name: L.agentForm.pick, exact: true }).click();
  await page.getByText(project).waitFor();
  await page.getByRole('button', { name: L.agentForm.save }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await side.getByRole('button', { name: /^@claude/ }).waitFor();

  // Reports: a page of the board, with no message box; people do not write there.
  const nav = side.getByRole('button', { name: new RegExp(`^${L.shell.reports}`) });
  await nav.click();
  await page.getByText(L.reports.empty).waitFor();
  assert.equal(await page.locator('.composer').count(), 0);
  await page.getByText(L.reports.closed).waitFor();
  await page.locator('.rtop .meter').waitFor();
  await shot(page, 'empty');

  // A routine made from there reports there; run now while another page is open.
  await page.getByRole('button', { name: L.routines.new }).first().click();
  const routine = page.getByRole('dialog', { name: L.routines.new });
  assert.equal(await routine.locator('#routine-channel').inputValue(), 'reports');
  await routine.getByRole('button', { name: '@claude' }).click();
  await routine.locator('#routine-text').pressSequentially('sabah raporu hazırla');
  await routine.locator('#routine-at').fill('08:30');
  await routine.getByRole('button', { name: L.agentForm.save }).click();
  await routine.waitFor({ state: 'detached' });
  await page.locator('.chat__head').getByRole('button', { name: L.shell.routines }).click();
  const card = page.locator('.routine');
  await card.getByText(L.routines.reportsTarget).waitFor();
  await card.getByRole('button', { name: L.routines.run }).click();
  await card.getByRole('button', { name: L.routines.ran }).waitFor();

  // Bub's toast over the screen, and the count of unread reports beside the page's name.
  await nav.locator('.nav__unread', { hasText: '2' }).waitFor({ timeout: 20_000 });
  const toastShown = async () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().endsWith('#toast') && w.isVisible()),
    );
  for (let i = 0; i < 60 && !(await toastShown()); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(await toastShown(), 'the report toast is shown');
  await new Promise((r) => setTimeout(r, 900));
  const toastPng = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith('#toast'));
    return (await w.webContents.capturePage()).toPNG().toString('base64');
  });
  writeFileSync(join(shots, 'rep-00-toast.png'), Buffer.from(toastPng, 'base64'));
  const toastText = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((x) => x.webContents.getURL().endsWith('#toast'))
      .webContents.executeJavaScript("document.querySelector('.toast__card')?.textContent ?? ''"),
  );
  assert.match(toastText, new RegExp(L.reports.toast.kind));
  await nav.click();

  // Two cards: the answer (titled by its heading, with the screenshot) and the report the agent posted.
  const answer = page.locator('.rcard', { hasText: 'Sabah raporu' });
  await answer.waitFor({ timeout: 20_000 });
  await answer.getByText(L.reports.state.done).waitFor({ timeout: 20_000 });
  const own = page.locator('.rcard', { hasText: 'Gece taraması: iki uyarı' });
  await own.waitFor();
  await answer.locator('.pics__item img').waitFor();
  assert.equal(await own.locator('.pics__item').count(), 1);
  await answer.getByText(L.reports.fromRoutine).waitFor();
  assert.equal(await page.locator('.rcard.is-unread').count(), 2);
  await own.locator('.rcard__asks').waitFor();
  // Pinned: it turns green and stands above the days.
  await own.getByRole('button', { name: L.reports.pin }).click();
  await page.locator('.reports__day--pinned').waitFor();
  await page.locator('.rcard.is-pinned .rpin.is-pinned').waitFor();
  await shot(page, 'cards');
  // A narrow window: the cards go to one column.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => !w.webContents.getURL().endsWith('#toast'))
      .setSize(960, 800),
  );
  await shot(page, 'cards-960');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => !w.webContents.getURL().endsWith('#toast'))
      .setSize(1440, 900),
  );

  // The report over the page: its text without the heading, the image, the note written while working.
  await answer.getByRole('button', { name: 'Sabah raporu' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sabah raporu' });
  await dialog.getByText('Testlerin hepsi geçti').waitFor();
  await dialog.locator('.report__gallery img').waitFor();
  await dialog.getByText('Ana ekran, 08:30').waitFor();
  await dialog.getByText(L.reports.notes_one.replace('{{count}}', '1')).click();
  await dialog.getByText('Testlere ve ana ekrana bakıyorum.').waitFor();
  await dialog.getByText('sabah raporu hazırla').waitFor();
  await shot(page, 'report');
  await dialog.locator('.report__gallery button').first().click();
  await page.locator('.lightbox img').waitFor();
  await shot(page, 'lightbox');
  await page.keyboard.press('Escape');
  await page.locator('.lightbox').waitFor({ state: 'detached' });
  await dialog.waitFor();

  // Answering it: the agent's own channel, the report attached to the message; the agent gets the report.
  await dialog.getByRole('button', { name: L.reports.answer }).click();
  await dialog.waitFor({ state: 'detached' });
  const composer = page.getByRole('textbox', { name: L.reports.answerPlaceholder });
  await composer.waitFor();
  await page.locator('.composer__cite', { hasText: 'Sabah raporu' }).waitFor();
  await shot(page, 'answering');
  await composer.fill('uyarıları düzelt');
  await composer.press('Enter');
  const sent = page.locator('.msg', { hasText: 'uyarıları düzelt' });
  await sent.locator('.cite', { hasText: 'Sabah raporu' }).waitFor();
  assert.equal(await page.locator('.composer__cite').count(), 0);
  await page.getByText(/raporunu aldım; uyarılara bakıyorum\./).waitFor({ timeout: 20_000 });
  await shot(page, 'answered');
  // The chip opens the report again.
  await sent.locator('.cite__open').click();
  await page.getByRole('dialog', { name: 'Sabah raporu' }).waitFor();
  await page.keyboard.press('Escape');

  // The questions of the posted report: one option, one left to the agent; the answers go to the agent's channel.
  await nav.click();
  await page
    .locator('.rcard', { hasText: 'Gece taraması: iki uyarı' })
    .getByRole('button', { name: 'Gece taraması: iki uyarı' })
    .click();
  const posted = page.getByRole('dialog', { name: 'Gece taraması: iki uyarı' });
  const decide = posted.locator('.decide');
  await decide.getByText('zod güncellemesi şimdi mi yapılsın?').waitFor();
  await decide.getByRole('button', { name: 'Hafta sonu' }).click();
  await decide.locator('.decide__q').nth(1).getByRole('button', { name: L.reports.said.yours }).click();
  await shot(page, 'decisions');
  await decide.getByRole('button', { name: L.reports.decisions.send_other.replace('{{count}}', '2') }).click();
  await posted.waitFor({ state: 'detached' });
  const decided = page.locator('.msg', { hasText: L.reports.said.decisions });
  await decided.locator('.cite', { hasText: 'Gece taraması' }).waitFor();
  await decided.getByText(new RegExp(L.reports.said.yours)).waitFor();
  await page
    .getByText(/raporunu aldım; uyarılara bakıyorum\./)
    .nth(1)
    .waitFor({ timeout: 20_000 });
  // Both reports were opened: none unread.
  assert.equal(await nav.locator('.nav__unread').count(), 0);

  // The overview's dashboard: tokens of the week and the efficiency meter.
  await side.getByRole('button', { name: L.shell.home }).click();
  await page.locator('.dash .meter').waitFor();
  await page.locator('.tweek__bar').first().waitFor();
  await shot(page, 'dashboard');

  // In the routine's channel the note the agent wrote while working stands as a message of its own.
  assert.deepEqual(errors, []);
  console.log('reports ok');
} catch (err) {
  await shot(page, 'failure').catch(() => {});
  console.error(err);
  console.error(errors);
  process.exitCode = 1;
} finally {
  await app.close();
}
