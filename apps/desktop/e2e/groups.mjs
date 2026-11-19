// End-to-end test of groups in the channel list and the channels' right-click menu, in the real app: a group made
// from the list's button and one from a channel's menu, a channel moved into a group from its menu and by
// dragging, a group collapsed, a channel renamed from its menu, the groups kept after a restart, a group renamed,
// moved and deleted (its channels go back to the list), the menu's keys.
// Usage: node e2e/groups.mjs   (after electron-vite build; E2E_EXE=release/win-unpacked/<name>.exe for packaged)
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
const L = locale('tr');
const shots = join(appDir, 'test-results');
mkdirSync(shots, { recursive: true });

const home = mkdtempSync(join(tmpdir(), 'lonca-e2e-groups-'));
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
const shot = async (name) => {
  await new Promise((r) => setTimeout(r, 400));
  n += 1;
  const png = await current.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'),
  );
  writeFileSync(join(shots, `groups-${String(n).padStart(2, '0')}-${name}.png`), Buffer.from(png, 'base64'));
};

async function launch() {
  const packaged = process.env.E2E_EXE ? join(appDir, process.env.E2E_EXE) : undefined;
  const app = await electron.launch({
    executablePath: packaged ?? electronPath,
    args: packaged ? [] : [appDir],
    env: { ...process.env, LONCA_HOME: home, LONCA_LANG: 'tr' },
  });
  current = app;
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.unmaximize();
    win.setContentSize(1280, 860);
  });
  const side = page.getByRole('complementary', { name: L.shell.channels });
  await side.getByRole('button', { name: L.shell.home, exact: true }).waitFor();
  return { app, page, errors, side };
}

const until = async (fn, what, ms = 10_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out: ${what}`);
};
const stored = () => JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')).groups ?? {};
const only = () => Object.values(stored())[0] ?? [];

let { app, page, errors, side } = await launch();
try {
  const channel = (name) => side.getByRole('button', { name: new RegExp(`^${name}(\\d|@)*$`) });
  const group = (name) => side.locator('.cgrp', { has: page.getByRole('button', { name, exact: true }) });
  const menuOf = () => page.getByRole('menu');
  const newChannel = async (name) => {
    await side.getByRole('button', { name: L.channel.create }).click();
    await side.getByRole('textbox', { name: L.channel.create }).fill(name);
    await side.getByRole('textbox', { name: L.channel.create }).press('Enter');
    await channel(name).waitFor();
  };
  await newChannel('tasarim');
  await newChannel('roblox');
  await newChannel('notlar');

  // A group from the list's button: empty, with a line on how to fill it.
  await side.getByRole('button', { name: L.groups.create }).click();
  await side.getByRole('textbox', { name: L.groups.create }).fill('Oyunlar');
  await side.getByRole('textbox', { name: L.groups.create }).press('Enter');
  await group('Oyunlar').getByText(L.groups.empty).waitFor();
  await until(() => only().length === 1, 'the group in the settings');

  // A channel's menu: moved into the group.
  await channel('roblox').click({ button: 'right' });
  await menuOf().waitFor();
  await shot('channel-menu');
  await menuOf().getByRole('menuitemradio', { name: 'Oyunlar' }).click();
  await menuOf().waitFor({ state: 'detached' });
  await group('Oyunlar').getByRole('button', { name: /^roblox/ }).waitFor();
  assert.equal(await group('Oyunlar').getByText(L.groups.empty).count(), 0);

  // A new group straight from a channel's menu takes that channel with it.
  await channel('notlar').click({ button: 'right' });
  await menuOf().getByRole('menuitem', { name: L.groups.newWith }).click();
  await side.getByRole('textbox', { name: L.groups.create }).fill('Yazı');
  await side.getByRole('textbox', { name: L.groups.create }).press('Enter');
  await group('Yazı').getByRole('button', { name: /^notlar/ }).waitFor();

  // Dragging a channel onto a group moves it there.
  await channel('tasarim').dragTo(group('Oyunlar').getByRole('button', { name: 'Oyunlar', exact: true }));
  await group('Oyunlar').getByRole('button', { name: /^tasarim/ }).waitFor();
  await until(() => only().find((g) => g.name === 'Oyunlar')?.channels.length === 2, 'two channels in Oyunlar');

  // Rename a channel from its menu.
  await channel('tasarim').click({ button: 'right' });
  await menuOf().getByRole('menuitem', { name: L.groups.renameChannel }).click();
  const rename = side.getByRole('textbox', { name: L.groups.renameChannel });
  await rename.fill('arayuz');
  await rename.press('Enter');
  await group('Oyunlar').getByRole('button', { name: /^arayuz/ }).waitFor();

  // A closed group hides its channels.
  await group('Oyunlar').getByRole('button', { name: 'Oyunlar', exact: true }).click();
  assert.equal(await group('Oyunlar').getByRole('button', { name: 'Oyunlar', exact: true }).getAttribute('aria-expanded'), 'false');
  assert.equal(await group('Oyunlar').getByRole('button', { name: /^roblox/ }).count(), 0);
  await shot('collapsed');

  // Group menu: move up, rename.
  await group('Yazı').getByRole('button', { name: 'Yazı', exact: true }).click({ button: 'right' });
  await menuOf().getByRole('menuitem', { name: L.groups.moveUp }).click();
  await until(() => only()[0]?.name === 'Yazı', 'Yazı first');
  await group('Yazı').getByRole('button', { name: 'Yazı', exact: true }).click({ button: 'right' });
  await menuOf().getByRole('menuitem', { name: L.groups.rename }).click();
  await side.getByRole('textbox', { name: L.groups.rename }).fill('Notlar');
  await side.getByRole('textbox', { name: L.groups.rename }).press('Enter');
  await group('Notlar').waitFor();
  await shot('groups');
  assert.deepEqual(errors, [], `console errors: ${errors.join('\n')}`);

  // After a restart the groups, their order and the closed one are as they were.
  await app.close();
  ({ app, page, errors, side } = await launch());
  await group('Notlar').waitFor();
  await group('Oyunlar').waitFor();
  assert.equal(await group('Oyunlar').getByRole('button', { name: 'Oyunlar', exact: true }).getAttribute('aria-expanded'), 'false');
  const order = await side.locator('.cgrp .cgrp__head').allInnerTexts();
  assert.deepEqual(order.map((s) => s.trim()), ['Notlar', 'Oyunlar']);

  // Opening it again; deleting a group puts its channels back in the list.
  await group('Oyunlar').getByRole('button', { name: 'Oyunlar', exact: true }).click();
  await group('Oyunlar').getByRole('button', { name: /^roblox/ }).waitFor();
  await group('Oyunlar').getByRole('button', { name: 'Oyunlar', exact: true }).click({ button: 'right' });
  await menuOf().getByRole('menuitem', { name: L.groups.delete }).click();
  await group('Oyunlar').waitFor({ state: 'detached' });
  await channel('roblox').waitFor();
  await channel('arayuz').waitFor();
  await until(() => only().length === 1, 'one group left');

  // A channel's menu answers the keyboard: arrows move, Esc closes.
  await channel('roblox').click({ button: 'right' });
  await menuOf().waitFor();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await menuOf().waitFor({ state: 'detached' });
  await shot('after');
  assert.deepEqual(errors, [], `console errors: ${errors.join('\n')}`);
  console.log('groups ok');
} finally {
  await app.close().catch(() => {});
  rmSync(home, { recursive: true, force: true });
}
