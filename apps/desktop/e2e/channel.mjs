// End-to-end test of channels and jobs in the real app, with a fake Claude Code (fake-claude.mjs) first on PATH:
// add an agent, call it in #genel, watch the job card fill and the answer arrive, open the live view, steer and
// stop a slow job in the agent's own channel, edit and delete a message, restart and find everything again.
// Usage: node e2e/channel.mjs   (after electron-vite build; E2E_EXE=release/win-unpacked/Lonca.exe for packaged)
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const appDir = join(here, '..');
const electronPath = createRequire(import.meta.url)('electron');
const L = JSON.parse(readFileSync(join(appDir, 'src/renderer/src/locales/tr.json'), 'utf8'));
const shots = join(appDir, 'test-results');
mkdirSync(shots, { recursive: true });

// A temporary home, a project folder for the agent, and the fake CLI in npm's shim format.
const home = mkdtempSync(join(tmpdir(), 'lonca-e2e-ch-'));
const project = mkdtempSync(join(tmpdir(), 'lonca-e2e-project-'));
writeFileSync(join(project, 'README.md'), '# Fake project\n');
const bin = mkdtempSync(join(tmpdir(), 'lonca-e2e-bin-'));
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
  writeFileSync(join(shots, `ch-${String(n).padStart(2, '0')}-${name}.png`), Buffer.from(png, 'base64'));
};

async function launch() {
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
  // The folder picker is a native dialog: answer it with the project folder.
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, project);
  return { app, page, errors };
}

const until = async (fn, what, ms = 20_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out: ${what}`);
};

const first = await launch();
let { page } = first;
try {
  await page.getByRole('heading', { name: L.shell.crew }).waitFor();

  // Add the agent from the suggestion of the installed (fake) CLI.
  await page.getByRole('button', { name: L.crew.add, exact: true }).click();
  await page.getByRole('dialog', { name: L.agentForm.new }).waitFor();
  await page.getByRole('button', { name: L.agentForm.pick, exact: true }).click();
  await page.getByText(project).waitFor();
  await shot(page, 'agent-form');
  await page.getByRole('button', { name: L.agentForm.save }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '@claude', exact: true }).waitFor();

  // Call it in #genel.
  await page.getByRole('button', { name: 'genel', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Mesaj · #genel' });
  await composer.fill('@claude README dosyasında ne var?');
  await composer.press('Enter');
  await page.getByText(L.job.state.done).first().waitFor({ timeout: 20_000 });
  await page.getByText('sahte proje').first().waitFor();
  await shot(page, 'job-done');
  assert.equal((await page.getByText(L.job.tool.read, { exact: true }).count()) > 0, true);
  assert.equal((await page.getByText('README.md').count()) > 0, true);

  // Live view of the job.
  await page.getByRole('button', { name: L.job.watch }).first().click();
  await page.getByRole('complementary', { name: L.job.live }).waitFor();
  await page.getByText('14 passed').first().waitFor();
  await shot(page, 'live-view');
  await page.getByRole('button', { name: L.common.close }).click();

  // The quota from the CLI's rate-limit events.
  await page.getByText(L.quota.window.five_hour).waitFor();

  // /todo puts a card on the board; the palette opens the board; the card runs as a job and moves to review.
  await composer.fill('/todo README dosyasını güncelle @claude');
  await composer.press('Enter');
  await page.getByText(L.board.added).waitFor();
  await page.keyboard.press('Control+k');
  const search = page.getByRole('textbox', { name: L.palette.placeholder });
  await search.fill('görev');
  await search.press('Enter');
  const todo = page.getByRole('region', { name: L.board.status.todo });
  await todo.getByText('README dosyasını güncelle').waitFor();
  await shot(page, 'board');
  await todo.getByRole('button', { name: L.board.run }).click();
  const review = page.getByRole('region', { name: L.board.status.review });
  await review.getByText('README dosyasını güncelle').waitFor({ timeout: 20_000 });
  await shot(page, 'board-review');

  // Lonca's MCP tools: the agent moves the card to done itself and posts a progress note.
  await page.keyboard.press('Control+k');
  await search.fill('genel');
  await search.press('Enter');
  await composer.fill('@claude panoyu güncelle');
  await composer.press('Enter');
  await page.getByText('bitti olarak işaretlendi').first().waitFor({ timeout: 20_000 });
  await page.getByText('lonca.update_card').first().waitFor();
  await page.getByText('Pano güncellendi').first().waitFor();
  await shot(page, 'mcp-tools');
  await page.keyboard.press('Control+k');
  await search.fill('görev');
  await search.press('Enter');
  await page.getByRole('region', { name: L.board.status.done }).getByText('README dosyasını güncelle').waitFor();

  // Records: save an answer as an idea, add a reference image, attach it to a job, use a saved command.
  await page.getByRole('button', { name: 'genel', exact: true }).click();
  const answerMsg = page.locator('.msg--agent').first();
  await answerMsg.hover();
  await answerMsg.getByRole('button', { name: L.records.saveMessage }).click();
  await page.getByText(L.records.saved).first().waitFor();
  await page.getByRole('button', { name: L.shell.ideas, exact: true }).click();
  await page.locator('.rec', { hasText: 'README bir' }).first().waitFor();

  await page.getByRole('button', { name: L.shell.references, exact: true }).click();
  const png = join(project, 'ekran.png');
  writeFileSync(png, Buffer.from(PNG_1X1, 'base64'));
  await page.locator('input[type=file]').setInputFiles(png);
  await page.locator('.rec', { hasText: 'ekran' }).first().waitFor();
  await shot(page, 'references');
  await page.getByRole('button', { name: L.records.attach }).click();
  await page.locator('.composer__refs .refchip', { hasText: 'ekran' }).waitFor();
  await composer.fill('@claude bu görsele göre düzenle');
  await composer.press('Enter');
  await page.locator('.msg__refs .refchip', { hasText: 'ekran' }).waitFor();
  await until(async () => (await page.getByText(L.job.state.done).count()) >= 2, 'job with a reference done');

  await page.getByRole('button', { name: L.shell.commands, exact: true }).click();
  await page.getByRole('button', { name: L.records.new.command }).click();
  await page.getByLabel(L.records.title).fill('Özet');
  await page.getByLabel(L.records.body.command).fill('{channel} kanalını özetle');
  await page.getByRole('button', { name: L.records.save, exact: true }).click();
  await page.getByRole('button', { name: L.records.use }).click();
  await until(async () => (await composer.inputValue()) === 'genel kanalını özetle', 'command in the message box');
  await composer.fill('');

  // Instructions: edit the worker template, see it in the preview, go back to the default.
  await page.keyboard.press('Control+Comma');
  const settingsDialog = page.getByRole('dialog', { name: L.settings.title });
  await settingsDialog.getByRole('button', { name: L.settings.tabs.instructions }).click();
  const template = settingsDialog.getByRole('textbox', { name: L.instructions.worker });
  await template.fill('Her yanıtı tek cümleyle ver, {user}.');
  await settingsDialog.getByRole('button', { name: L.instructions.save }).first().click();
  await settingsDialog.getByText(L.instructions.edited).waitFor();
  await settingsDialog.getByText('Her yanıtı tek cümleyle ver, Kaan.').waitFor();
  await shot(page, 'instructions');
  await settingsDialog.getByRole('button', { name: L.instructions.reset }).click();
  await settingsDialog.getByText(L.instructions.isDefault, { exact: true }).waitFor();
  await page.keyboard.press('Escape');

  // The shortcut list, then back to the channel through the palette.
  await page.keyboard.press('Control+/');
  await page.getByRole('dialog', { name: L.shortcuts.title }).waitFor();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await search.fill('genel');
  await search.press('Enter');
  await composer.waitFor();

  // In the agent's own channel: a slow job, steered, then stopped.
  await page.getByRole('button', { name: '@claude', exact: true }).click();
  const agentComposer = page.getByRole('textbox', { name: 'Mesaj · @claude' });
  await agentComposer.fill('yavaş bir iş yap');
  await agentComposer.press('Enter');
  await page.getByText(L.job.state.running).first().waitFor();
  await page.getByRole('button', { name: L.job.steer, exact: true }).click();
  const steer = page.getByRole('textbox', { name: L.job.steer });
  await steer.fill('testleri de çalıştır');
  await steer.press('Enter');
  await page.getByText('testleri de çalıştır').first().waitFor();
  await shot(page, 'job-steered');
  await page.getByRole('button', { name: L.job.stop }).click();
  await page.getByText(L.job.state.stopped).first().waitFor();
  await shot(page, 'job-stopped');

  // Edit and delete own messages.
  await page.getByRole('button', { name: 'genel', exact: true }).click();
  const own = page.locator('.msg--person').first();
  await own.hover();
  await own.getByRole('button', { name: L.channel.edit }).click();
  const editor = own.getByRole('textbox', { name: L.channel.edit });
  await editor.fill('@claude README dosyasında ne var? (düzeltildi)');
  await editor.press('Enter');
  await page.getByText(L.channel.edited).waitFor();

  await composer.fill('silinecek mesaj');
  await composer.press('Enter');
  const doomed = page.locator('.msg--person', { hasText: 'silinecek mesaj' });
  await doomed.hover();
  await doomed.getByRole('button', { name: L.channel.delete }).click();
  await until(async () => (await doomed.count()) === 0, 'message deleted');
  assert.deepEqual(first.errors, [], first.errors.join('\n'));
} finally {
  await first.app.close();
}

// Everything is still there after a restart; the stopped job stays stopped.
const second = await launch();
page = second.page;
try {
  await page.getByRole('heading', { name: L.shell.crew }).waitFor();
  await page.getByRole('button', { name: 'genel', exact: true }).click();
  await page.getByText('(düzeltildi)').waitFor();
  await page.getByText('sahte proje').first().waitFor();
  assert.equal(await page.getByText('silinecek mesaj').count(), 0);
  await page.getByRole('button', { name: '@claude', exact: true }).click();
  await page.getByText(L.job.state.stopped).first().waitFor();
  await shot(page, 'restart');
  assert.deepEqual(second.errors, [], second.errors.join('\n'));
} finally {
  await second.app.close();
}

if (process.env.E2E_KEEP !== '1') for (const d of [home, project, bin]) rmSync(d, { recursive: true, force: true });
console.log(`channel e2e ok, ${n} screenshots in ${shots}`);
