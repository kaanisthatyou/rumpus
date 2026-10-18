// Two real apps on one computer, talking over loopback instead of Tailscale: Kaan makes a team lonca and invites
// Arda as an editor, Arda joins with the code, Kaan approves, and messages travel both ways.
// Usage: node e2e/team.mjs   (after electron-vite build; E2E_EXE=release/win-unpacked/Lonca.exe for packaged)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const electronPath = createRequire(import.meta.url)('electron');
const L = JSON.parse(readFileSync(join(appDir, 'src/renderer/src/locales/tr.json'), 'utf8'));
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

async function launch(name) {
  const dir = home(name);
  const packaged = process.env.E2E_EXE ? join(appDir, process.env.E2E_EXE) : undefined;
  const app = await electron.launch({
    executablePath: packaged ?? electronPath,
    args: packaged ? [] : [appDir],
    env: { ...process.env, LONCA_HOME: dir, LONCA_LANG: 'tr', LONCA_PEER_HOST: '127.0.0.1', LONCA_PEER_PORT: '0' },
  });
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

const kaan = await launch('Kaan');
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
  assert.ok(code.startsWith('LONCA1.'), code);
  await kaan.shot('invite');
  await p.keyboard.press('Escape');

  // Arda: join with the code; the lonca waits for approval.
  p = arda.page;
  await p.getByRole('button', { name: L.shell.newWorkspace }).click();
  dialog = p.getByRole('dialog', { name: L.shell.newWorkspace });
  await dialog.getByRole('button', { name: L.workspaces.join }).click();
  await dialog.getByLabel(L.workspaces.code, { exact: true }).fill(code);
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
  await p.getByRole('button', { name: 'genel', exact: true }).click();
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
  assert.deepEqual(kaan.errors, [], kaan.errors.join('\n'));
  assert.deepEqual(arda.errors, [], arda.errors.join('\n'));
  console.log('team e2e ok');
} finally {
  await kaan.app.close().catch(() => {});
  await arda.app.close().catch(() => {});
  rmSync(kaan.dir, { recursive: true, force: true });
  rmSync(arda.dir, { recursive: true, force: true });
}
