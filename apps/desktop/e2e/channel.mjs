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
  await page.getByRole('button', { name: L.agentForm.pick }).click();
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
