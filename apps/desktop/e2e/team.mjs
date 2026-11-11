// Two real apps on one computer, talking over loopback instead of Tailscale: Kaan makes a team lonca and invites
// Arda as an editor, Arda joins with the code, Kaan approves, and messages travel both ways. Then Kaan's agent (a
// fake Claude Code on Kaan's PATH only) is opened to editors, and Arda's mention runs it on Kaan's computer.
// Usage: node e2e/team.mjs   (after electron-vite build; E2E_EXE=release/win-unpacked/Rumpus.exe for packaged)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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

function home(name) {
  const dir = mkdtempSync(join(tmpdir(), `lonca-e2e-team-${name}-`));
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({
      v: 1,
      language: 'tr',
      theme: 'dark',
      accent: 'lime',
      motion: 'system',
      profile: { name },
      dataDir: '',
      onboarded: true,
    }),
  );
  return dir;
}

// The fake Claude Code, in npm's shim format, for Kaan's app only.
const bin = mkdtempSync(join(tmpdir(), 'lonca-e2e-team-bin-'));
copyFileSync(join(here, 'fake-claude.mjs'), join(bin, 'fake-claude.mjs'));
if (process.platform === 'win32') {
  writeFileSync(
    join(bin, 'claude.cmd'),
    '@ECHO off\r\nSETLOCAL\r\nSET dp0=%~dp0\r\nnode "%dp0%\\fake-claude.mjs" %*\r\n',
  );
} else {
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec node "${join(bin, 'fake-claude.mjs')}" "$@"\n`, { mode: 0o755 });
}
const project = mkdtempSync(join(tmpdir(), 'lonca-e2e-team-project-'));
writeFileSync(join(project, 'README.md'), '# Fake project\n');

async function launch(name, withClaude = false) {
  const dir = home(name);
  const packaged = process.env.E2E_EXE ? join(appDir, process.env.E2E_EXE) : undefined;
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const app = await electron.launch({
    executablePath: packaged ?? electronPath,
    args: packaged ? [] : [appDir],
    env: {
      ...process.env,
      ...(withClaude ? { [pathKey]: `${bin}${delimiter}${process.env[pathKey]}` } : {}),
      LONCA_HOME: dir,
      LONCA_LANG: 'tr',
      LONCA_PEER_HOST: '127.0.0.1',
      LONCA_PEER_PORT: '0',
    },
  });
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, project);
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.getByRole('heading', { name: L.shell.crew }).waitFor();
  const shot = async (label) => {
    await page.waitForTimeout(400);
    const png = await app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'),
    );
    writeFileSync(join(shots, `team-${name.toLowerCase()}-${label}.png`), Buffer.from(png, 'base64'));
  };
  return { app, page, errors, dir, shot };
}

const kaan = await launch('Kaan', true);
const arda = await launch('Arda');
try {
  // Kaan: a team lonca and an invite for an editor.
  let p = kaan.page;
  await p.getByRole('button', { name: L.shell.newWorkspace }).click();
  let dialog = p.getByRole('dialog', { name: L.shell.newWorkspace });
  await dialog.getByLabel(L.workspaces.name, { exact: true }).fill('Ekip');
  await dialog.getByRole('button', { name: L.workspaces.create }).click();
  await p.getByRole('heading', { name: 'Ekip', exact: true }).waitFor();
  await p.getByRole('button', { name: L.shell.invite }).click();
  dialog = p.getByRole('dialog', { name: L.invite.title });
  await dialog.getByText(L.shell.role.editor, { exact: true }).click();
  await dialog.getByRole('button', { name: L.invite.make }).click();
  const codeBox = dialog.getByRole('textbox', { name: L.invite.code });
  await codeBox.waitFor();
  const code = await codeBox.inputValue();
  assert.ok(code.startsWith('RUMPUS1.'), code);
  await dialog.getByRole('button', { name: L.invite.copyMessage }).waitFor();
  await dialog.getByText(L.invite.steps.code).waitFor();
  await kaan.shot('invite');
  await p.keyboard.press('Escape');

  // Arda opens the invite link: a second copy of the app hands it to the running one and quits, and the join
  // dialog opens with the invite read (which workspace) and the way to Kaan's app tried.
  p = arda.page;
  const packaged = process.env.E2E_EXE ? join(appDir, process.env.E2E_EXE) : undefined;
  spawn(packaged ?? electronPath, [...(packaged ? [] : [appDir]), `rumpus://join/${code}`], {
    env: { ...process.env, LONCA_HOME: arda.dir, LONCA_LANG: 'tr', LONCA_PEER_HOST: '127.0.0.1', LONCA_PEER_PORT: '0' },
    stdio: 'ignore',
  });
  dialog = p.getByRole('dialog', { name: L.workspaces.join });
  await dialog.waitFor({ timeout: 30_000 });
  assert.equal(await dialog.getByLabel(L.workspaces.code, { exact: true }).inputValue(), `rumpus://join/${code}`);
  await dialog.getByText(L.join.reach.ok).waitFor();
  await dialog.getByText('Ekip', { exact: true }).waitFor();
  await arda.shot('join-check');
  // Something that is not an invite is said to be none, and the request cannot be sent.
  await dialog.getByLabel(L.workspaces.code, { exact: true }).fill('merhaba');
  await dialog.getByText(L.join.bad).waitFor();
  assert.equal(await dialog.getByRole('button', { name: L.workspaces.askToJoin }).isDisabled(), true);
  await dialog.getByLabel(L.workspaces.code, { exact: true }).fill(code);
  await dialog.getByText(L.join.reach.ok).waitFor();
  await dialog.getByRole('button', { name: L.workspaces.askToJoin }).click();
  await p.getByRole('button', { name: `Ekip · ${L.workspaces.state.joining}` }).waitFor();

  // Kaan approves.
  p = kaan.page;
  const requests = p.getByRole('list', { name: L.invite.requests });
  await requests.getByText('Arda').waitFor();
  await kaan.shot('request');
  await requests.getByRole('button', { name: L.invite.approve }).click();

  // Arda: the lonca opens with Kaan's channel; a message goes over.
  p = arda.page;
  const ekip = p.getByRole('button', { name: 'Ekip', exact: true });
  await ekip.waitFor({ timeout: 30_000 });
  await ekip.click();
  await p.getByRole('heading', { name: 'Ekip', exact: true }).waitFor();
  await p.getByRole('button', { name: /^genel/ }).click();
  const ardaBox = p.getByRole('textbox', { name: 'Mesaj · #genel' });
  await ardaBox.fill('Merhaba, ben Arda');
  await ardaBox.press('Enter');

  p = kaan.page;
  await p.locator('.msg', { hasText: 'Merhaba, ben Arda' }).waitFor({ timeout: 30_000 });
  const kaanBox = p.getByRole('textbox', { name: 'Mesaj · #genel' });
  await kaanBox.fill('Hoş geldin');
  await kaanBox.press('Enter');
  const members = p.getByRole('list', { name: L.shell.members });
  await members.getByText('Arda').waitFor();
  await kaan.shot('members');

  p = arda.page;
  await p.locator('.msg', { hasText: 'Hoş geldin' }).waitFor({ timeout: 30_000 });
  await arda.shot('chat');

  // Arda typing shows on Kaan's side; nothing is stored.
  await ardaBox.fill('yazıyorum');
  await kaan.page.getByText(L.advisor.typing.replace('{{names}}', 'Arda')).waitFor({ timeout: 15_000 });
  await kaan.shot('typing');
  await ardaBox.fill('');

  // Kaan in the personal lonca: a message from Arda marks the team lonca in the rail.
  await kaan.page.getByRole('button', { name: L.shell.workspace, exact: true }).click();
  await ardaBox.fill('Kaan, arka planda mısın?');
  await ardaBox.press('Enter');
  const news = kaan.page.getByRole('button', { name: `Ekip · ${L.workspaces.news}` });
  await news.waitFor({ timeout: 30_000 });
  await news.click();
  await kaan.page.locator('.msg', { hasText: 'arka planda mısın' }).waitFor();
  p = arda.page;

  // Kaan's agent, open to editors: Arda's mention runs on Kaan's computer and the answer comes back.
  p = kaan.page;
  await p.getByRole('button', { name: L.crew.add, exact: true }).click();
  dialog = p.getByRole('dialog', { name: L.agentForm.new });
  await dialog.getByRole('button', { name: L.agentForm.pick, exact: true }).click();
  await dialog.getByText(L.agentForm.access.members, { exact: true }).click();
  await kaan.shot('agent-access');
  await dialog.getByRole('button', { name: L.agentForm.save }).click();
  await dialog.waitFor({ state: 'detached' });

  p = arda.page;
  const crew = p.getByRole('complementary', { name: L.shell.crew });
  await crew.getByText(L.agent.on.replace('{{name}}', 'Kaan')).waitFor({ timeout: 30_000 });
  await ardaBox.fill('@claude README ne anlatıyor?');
  await ardaBox.press('Enter');
  await p.locator('.msg--agent', { hasText: 'sahte proje' }).waitFor({ timeout: 60_000 });
  await p.locator('.job', { hasText: L.agent.on.replace('{{name}}', 'Kaan') }).waitFor();
  await arda.shot('remote-job');
  assert.deepEqual(kaan.errors, [], kaan.errors.join('\n'));
  assert.deepEqual(arda.errors, [], arda.errors.join('\n'));
  console.log('team e2e ok');
} finally {
  await kaan.app.close().catch(() => {});
  await arda.app.close().catch(() => {});
  rmSync(kaan.dir, { recursive: true, force: true });
  rmSync(bin, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
  rmSync(arda.dir, { recursive: true, force: true });
}
