// End-to-end test of specialists in the real app, with the fake Claude Code first on PATH: make one from a
// template, call it in #genel (it reads the channel, keeps a lesson, hands a RESULT over), find the lesson in its
// settings, and watch a slow job against its budget.
// Usage: node e2e/specialists.mjs   (after electron-vite build; E2E_EXE=release/win-unpacked/Serai.exe for packaged)
import assert from 'node:assert/strict';
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
const L = locale('tr');
const shots = join(appDir, 'test-results');
mkdirSync(shots, { recursive: true });

const home = mkdtempSync(join(tmpdir(), 'lonca-e2e-spec-'));
const project = mkdtempSync(join(tmpdir(), 'lonca-e2e-spec-project-'));
writeFileSync(join(project, 'README.md'), '# Fake project\n');
const bin = mkdtempSync(join(tmpdir(), 'lonca-e2e-spec-bin-'));
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
const shot = async (page, name) => {
  await page.waitForTimeout(500);
  n += 1;
  const png = await current.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'),
  );
  writeFileSync(join(shots, `sp-${String(n).padStart(2, '0')}-${name}.png`), Buffer.from(png, 'base64'));
};

const packaged = process.env.E2E_EXE ? join(appDir, process.env.E2E_EXE) : undefined;
const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
const app = await electron.launch({
  executablePath: packaged ?? electronPath,
  args: packaged ? [] : [appDir],
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

try {
  await page.getByRole('heading', { name: L.shell.crew }).waitFor();
  const composer = page.getByRole('textbox', { name: 'Mesaj · #genel' });
  await composer.fill('Girişe e-posta doğrulaması eklendi, testleri yarın yazılacak.');
  await composer.press('Enter');
  await page.getByText('e-posta doğrulaması').first().waitFor();

  // The gallery, then the form filled from the template.
  await page.getByRole('button', { name: L.specialists.new, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: L.specialists.new });
  await dialog.waitFor();
  await dialog.getByText(L.specialists.templates.modeler.name).waitFor();
  await shot(page, 'gallery');
  await dialog.getByText(L.specialists.templates.reviewer.name, { exact: true }).click();
  assert.equal(
    await dialog.getByLabel(L.agentForm.name, { exact: true }).inputValue(),
    L.specialists.templates.reviewer.name,
  );
  assert.equal(await dialog.getByLabel(L.agentForm.handle, { exact: true }).inputValue(), 'inceleme');
  assert.equal(
    await dialog.getByLabel(L.specialists.role, { exact: true }).inputValue(),
    L.specialists.templates.reviewer.role,
  );
  await dialog.getByRole('button', { name: L.agentForm.pick, exact: true }).click();
  await dialog.getByText(project).waitFor();
  await shot(page, 'form-who');
  const tabs = dialog.locator('.specform__tabs');
  await tabs.getByText(L.specialists.tabs.playbook, { exact: true }).click();
  assert.match(await dialog.locator('#spec-playbook').inputValue(), /You review changes/);
  await shot(page, 'form-playbook');
  await tabs.getByText(L.specialists.tabs.context, { exact: true }).click();
  await dialog.getByText(L.specialists.budgetHint).waitFor();
  assert.equal(await dialog.getByLabel(L.specialists.budgetMinutes, { exact: true }).inputValue(), '15');
  await shot(page, 'form-context');
  await dialog.getByRole('button', { name: L.agentForm.save }).click();
  await dialog.waitFor({ state: 'detached' });

  // It stands in its own group, with what it is for.
  const crew = page.getByRole('complementary', { name: L.shell.crew });
  await crew.getByText('@inceleme').waitFor();
  await crew.getByText(L.specialists.templates.reviewer.role).waitFor();

  // Called in #genel: it read the channel, kept a lesson and handed a RESULT over, which is not in the text.
  await composer.fill('@inceleme son değişikliği incele');
  await composer.press('Enter');
  await page.getByText('Bir bulgu var').first().waitFor({ timeout: 20_000 });
  await page.getByText('Kanalda e-posta doğrulamasından söz edilmiş.').waitFor();
  const result = page.locator('.result');
  await result.getByText(L.specialists.resultFailed).waitFor();
  await result.getByText('findings').waitFor();
  assert.equal(await page.getByText('RESULT {').count(), 0);
  await page.getByText('serai.learn_lesson').first().waitFor();
  await crew.getByTitle(L.specialists.learned_other.replace('{{count}}', '1')).waitFor();
  await shot(page, 'result');

  // The lesson is in its settings, where its owner edits it.
  await crew.getByRole('button', { name: L.specialists.edit }).click();
  const edit = page.getByRole('dialog', { name: L.specialists.edit });
  await edit.locator('.specform__tabs').getByText(L.specialists.tabs.lessons, { exact: true }).click();
  assert.match(await edit.locator('#spec-lessons').inputValue(), /^- Bu projede testler `npm test` ile/);
  await shot(page, 'lessons');

  // Shared as text (without its folder and lessons), and pasted into the gallery it fills a new form.
  await edit.getByRole('button', { name: L.specialists.share.copy }).click();
  const sharedText = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert.equal(JSON.parse(sharedText).serai, 'specialist');
  assert.equal(sharedText.includes('npm test'), false);
  await edit.getByRole('button', { name: L.agentForm.cancel }).click();
  await edit.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: L.specialists.new, exact: true }).click();
  const again = page.getByRole('dialog', { name: L.specialists.new });
  await again.getByRole('button', { name: L.specialists.share.paste }).click();
  await again.locator('#spec-paste').fill('bu bir uzman değil');
  await again.getByText(L.specialists.share.bad).waitFor();
  await again.locator('#spec-paste').fill(sharedText);
  assert.equal(await again.getByLabel(L.agentForm.handle, { exact: true }).inputValue(), 'inceleme-2');
  assert.equal(
    await again.getByLabel(L.specialists.role, { exact: true }).inputValue(),
    L.specialists.templates.reviewer.role,
  );
  await again.getByRole('button', { name: L.agentForm.cancel }).click();
  await again.waitFor({ state: 'detached' });

  // A slow job runs against the budget, shown on its card; it stops like any other job.
  await composer.fill('@inceleme yavaş yavaş bak');
  await composer.press('Enter');
  await page.locator('.job__budget').waitFor({ timeout: 20_000 });
  await page.getByText('/ 15:00').waitFor();
  await shot(page, 'budget');

  // The overview while it runs: the job under "running now", the setup steps with the specialist's one done,
  // today's numbers, the earlier job among the latest ones.
  const side = page.getByRole('complementary', { name: L.shell.channels });
  await side.getByRole('button', { name: L.shell.home }).click();
  const home = page.locator('.home');
  await home.locator('.run').getByText(L.specialists.templates.reviewer.name).waitFor();
  await home.getByText(L.overview.setup.specialist.title).waitFor();
  assert.equal(await home.locator('.setup__step.is-done').count(), 1);
  await home.locator('.past').getByText('@inceleme son değişikliği incele').waitFor();
  await home.getByText(L.overview.week).waitFor();
  await shot(page, 'overview');

  // Its answer arrives while another page is open: the channel shows one unread message until it is opened.
  const genel = side.getByRole('button', { name: /^genel/ });
  await genel.locator('.nav__unread').waitFor({ timeout: 20_000 });
  assert.equal((await genel.locator('.nav__unread').innerText()).trim(), '1');
  await home.getByText(L.overview.nowNone).waitFor();
  await shot(page, 'overview-idle');
  await genel.click();
  await composer.waitFor();
  assert.equal(await side.locator('.nav__unread').count(), 0);

  // A routine: the person's message, posted for them at a set time; run now, it calls the specialist.
  await side.getByRole('button', { name: L.shell.routines }).click();
  await page.getByText(L.shell.empty.routines).waitFor();
  await page.getByRole('button', { name: L.routines.new }).first().click();
  const routine = page.getByRole('dialog', { name: L.routines.new });
  await routine.getByRole('button', { name: '@inceleme' }).click();
  await routine.locator('#routine-text').pressSequentially('son değişikliği incele');
  await routine.locator('#routine-at').fill('09:30');
  await routine.locator('.daypick__day').first().click();
  await routine.getByText(L.routines.someDays).waitFor();
  await shot(page, 'routine-form');
  await routine.getByRole('button', { name: L.agentForm.save }).click();
  await routine.waitFor({ state: 'detached' });
  const card = page.locator('.routine');
  await card.getByText('09:30', { exact: true }).waitFor();
  await card.getByText('@inceleme son değişikliği incele').waitFor();
  await card.getByText('#genel').waitFor();
  await shot(page, 'routines');
  await card.getByRole('button', { name: L.routines.run }).click();
  await card.getByRole('button', { name: L.routines.ran }).waitFor();
  await genel.click();
  const posted = page.locator('.msg', { hasText: L.routines.message }).last();
  await posted.getByText('@inceleme son değişikliği incele').waitFor();
  await posted.getByText(L.job.state.done).waitFor({ timeout: 20_000 });
  await shot(page, 'routine-ran');

  assert.deepEqual(errors, []);
  console.log('specialists e2e ok');
} catch (err) {
  await shot(page, 'failed').catch(() => {});
  console.error(errors.join('\n'));
  throw err;
} finally {
  await app.close();
  for (const dir of [home, project, bin]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // a still-open handle on Windows: the temp folder is cleaned up by the OS later
    }
  }
}
