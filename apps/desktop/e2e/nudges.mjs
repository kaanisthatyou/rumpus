// End-to-end test of reminders (PLAN.md 5.23) in the real app, with the fake Claude Code first on PATH and the
// reminders' minutes made into fractions of a second (LONCA_NUDGE_SCALE): the setting is off until turned on; a job
// waits for an approval, the agent types and writes one reminder in its channel and no second; the button under it
// goes when pressed; the setting turns them off again.
// Usage: node e2e/nudges.mjs   (after electron-vite build)
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

const home = mkdtempSync(join(tmpdir(), 'lonca-e2e-nudge-'));
const project = mkdtempSync(join(tmpdir(), 'lonca-e2e-nudge-project-'));
writeFileSync(join(project, 'README.md'), '# Fake project\n');
const bin = mkdtempSync(join(tmpdir(), 'lonca-e2e-nudge-bin-'));
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
    // No quiet hours, whenever the test runs.
    quietHours: { from: '00:00', to: '00:00' },
  }),
);

let n = 0;
let current;
const shot = async (_page, name) => {
  await new Promise((r) => setTimeout(r, 400));
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
  writeFileSync(join(shots, `nudge-${String(n).padStart(2, '0')}-${name}.png`), Buffer.from(png, 'base64'));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (check, what, ms = 30_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(150);
  }
  throw new Error(`timed out: ${what}`);
};

const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
const app = await electron.launch({
  executablePath: electronPath,
  args: [appDir],
  env: {
    ...process.env,
    [pathKey]: `${bin}${delimiter}${process.env[pathKey]}`,
    LONCA_HOME: home,
    LONCA_LANG: 'tr',
    // Fifteen minutes before the reminder: under three seconds.
    LONCA_NUDGE_SCALE: '0.003',
  },
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
    .setSize(1280, 860),
);

try {
  await page.getByRole('heading', { name: L.shell.crew }).waitFor();
  const side = page.getByRole('complementary', { name: L.shell.channels });
  await page.getByRole('button', { name: L.crew.add, exact: true }).click();
  const form = page.getByRole('dialog', { name: L.agentForm.new });
  await form.waitFor();
  // Off by default (Kaan, 2026-11-23): turned on here.
  const nudgeSwitch = form.getByRole('switch', { name: L.agentForm.nudges });
  assert.equal(await nudgeSwitch.getAttribute('aria-checked'), 'false');
  await nudgeSwitch.click();
  assert.equal(await nudgeSwitch.getAttribute('aria-checked'), 'true');
  await form.getByText(L.agentForm.nudgesHint).waitFor();
  await page.getByRole('button', { name: L.agentForm.pick, exact: true }).click();
  await page.getByText(project).waitFor();
  await page.getByRole('button', { name: L.agentForm.save }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await side.getByRole('button', { name: /^@claude/ }).click();

  // A job that waits for an approval: the agent types, then writes a reminder with a button.
  const box = page.getByRole('textbox', { name: 'Mesaj · @claude' });
  await box.fill('onay iste');
  await box.press('Enter');
  await page.getByText(L.job.approval.title).first().waitFor();
  const typing = page.locator('.typing', { hasText: 'Claude' });
  await typing.waitFor({ timeout: 20_000 });
  await shot(page, 'typing');
  const buttons = page.locator('.msg__nudge button');
  await buttons.first().waitFor({ timeout: 20_000 });
  const reminder = page.locator('.msg', { has: page.locator('.msg__nudge') }).first();
  assert.match(await reminder.innerText(), /Claude/);
  await shot(page, 'reminder');
  // Only one: no second while it still waits.
  await sleep(8000);
  assert.equal(await buttons.count(), 1, 'one reminder');

  // The button under it goes when pressed, and no new one comes.
  await buttons.last().click();
  await until(async () => (await buttons.count()) === 0, 'the buttons gone');
  const after = await page.locator('.msg--agent').count();
  await sleep(6000);
  assert.equal(await buttons.count(), 0, 'no reminder after the button');
  assert.equal(await page.locator('.msg--agent').count(), after);
  await shot(page, 'stopped');

  // The approval is given: the job goes on.
  await page.getByRole('button', { name: L.job.approval.allow }).click();
  await page.getByText('Derleme tamam.').waitFor();

  // Turned off in the agent's settings: a new wait brings no reminder.
  await page.locator('.who', { hasText: '@claude' }).getByRole('button', { name: L.agentForm.edit }).click();
  const edit = page.getByRole('dialog', { name: L.agentForm.edit });
  await edit.getByRole('switch', { name: L.agentForm.nudges }).click();
  await edit.getByRole('button', { name: L.agentForm.save }).click();
  await edit.waitFor({ state: 'detached' });
  await box.fill('onay iste');
  await box.press('Enter');
  await page.getByRole('button', { name: L.job.approval.deny }).waitFor();
  await sleep(9000);
  assert.equal(await buttons.count(), 0, 'no reminder with the setting off');
  assert.equal(await typing.count(), 0);
  await page.getByRole('button', { name: L.job.approval.deny }).click();
  await page.getByText('Derleme reddedildi').waitFor();

  assert.deepEqual(errors, []);
  console.log('nudges ok');
} catch (err) {
  await shot(page, 'failure').catch(() => {});
  console.error(err);
  console.error(errors);
  process.exitCode = 1;
} finally {
  await app.close();
}
