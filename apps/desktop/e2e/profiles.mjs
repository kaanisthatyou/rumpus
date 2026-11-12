// Profiles, the look of a workspace, roles, friends and the invite card (PLAN.md 5.19, 5.20): two real apps on one
// computer over loopback. Kaan fills in his profile (text, a color, a picture) and gives the team workspace a
// description, an icon and a role; Kaan adds Arda as a friend with her code and she accepts; the invite Kaan
// writes into their conversation shows as a card on both sides and Arda joins from it; then each sees the other
// as they present themselves, and Kaan gives Arda the role from her profile card.
// Usage: node e2e/profiles.mjs   (after electron-vite build; E2E_EXE=release/win-unpacked/Rumpus.exe for packaged)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
/** A real picture to pick: the app's own icon. */
const picture = join(appDir, 'build', 'icon.png');

function home(name) {
  const dir = mkdtempSync(join(tmpdir(), `lonca-e2e-prof-${name}-`));
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
    await page.waitForTimeout(450);
    const png = await app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'),
    );
    writeFileSync(join(shots, `profiles-${name.toLowerCase()}-${label}.png`), Buffer.from(png, 'base64'));
  };
  return { app, page, errors, dir, shot };
}

const of = (text, vars) => Object.entries(vars).reduce((s, [k, v]) => s.replace(`{{${k}}}`, v), text);

const kaan = await launch('Kaan');
const arda = await launch('Arda');
try {
  // ---------------------------------------------------------------- Kaan's profile
  let p = kaan.page;
  await p
    .getByRole('complementary', { name: L.shell.channels })
    .getByRole('button', { name: L.shell.settings })
    .click();
  let dialog = p.getByRole('dialog', { name: L.settings.title });
  await dialog.getByRole('button', { name: L.settings.tabs.profile }).click();
  const status = dialog.getByLabel(L.profile.status);
  await status.fill('derleme bekliyor');
  await status.press('Enter');
  // The counter next to the label follows what is typed.
  await dialog.getByText('16 / 60').waitFor();
  const bio = dialog.getByLabel(L.profile.bio);
  await bio.fill('Oyun ve araç yapar.\nKahve içer.');
  await bio.blur();
  await dialog.getByLabel(`${L.profile.color}: #3e9bdc`).check({ force: true });
  await dialog.getByLabel(`${L.profile.avatar}: ${L.profile.choose}`).setInputFiles(picture);
  const preview = dialog.getByRole('complementary', { name: L.profile.preview });
  await preview.locator('.l-avatar img').waitFor();
  await preview.getByText('derleme bekliyor').waitFor();
  await preview.getByText('Kahve içer.').waitFor();
  // A two-color theme draws the card's edge.
  await dialog.getByRole('switch', { name: L.profile.themeOn }).click();
  await preview.locator('.pcard--themed').waitFor();
  await kaan.shot('settings');
  await p.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  // The person's own card at the bottom of the channel list shows the picture and the status, and opens the card.
  const mine = p.locator('.me');
  await mine.locator('.l-avatar img').waitFor();
  await mine.getByText('derleme bekliyor').waitFor();
  await mine.getByRole('button', { name: of(L.profile.open, { name: 'Kaan' }) }).click();
  let card = p.getByRole('dialog', { name: of(L.profile.of, { name: 'Kaan' }) });
  await card.getByText('Oyun ve araç yapar.').waitFor();
  await card.getByRole('button', { name: L.profile.edit }).waitFor();
  await kaan.shot('own-card');
  await p.keyboard.press('Escape');
  await card.waitFor({ state: 'detached' });

  // ---------------------------------------------------------------- the workspace's look and a role
  await p.getByRole('button', { name: L.shell.newWorkspace }).click();
  dialog = p.getByRole('dialog', { name: L.shell.newWorkspace });
  await dialog.getByLabel(L.workspaces.name).fill('Ekip');
  await dialog.getByText('4 / 40').waitFor();
  await dialog.getByRole('button', { name: L.workspaces.create }).click();
  await p.getByRole('heading', { name: 'Ekip', exact: true }).waitFor();
  await p.getByRole('button', { name: L.wsForm.open }).click();
  dialog = p.getByRole('dialog', { name: L.wsForm.title });
  const about = dialog.getByLabel(L.wsForm.about);
  await about.fill('Oyun ekibinin çalışma alanı.');
  await about.blur();
  await dialog.getByLabel(`${L.wsForm.icon}: ${L.profile.choose}`).setInputFiles(picture);
  await dialog.locator('.wshead__icon img').waitFor();
  await dialog.getByLabel(L.wsForm.roleName, { exact: true }).fill('Tasarım');
  await dialog.getByLabel(`${L.wsForm.newRoleColor}: #ab4aba`).check({ force: true });
  await dialog.getByRole('button', { name: L.wsForm.roleAdd }).click();
  await dialog.getByLabel(of(L.wsForm.roleNameOf, { name: 'Tasarım' })).waitFor();
  await kaan.shot('workspace');
  await p.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  // The rail shows the icon, the channel list the description.
  await p.getByRole('button', { name: 'Ekip', exact: true }).locator('img').waitFor();
  await p.locator('.side__about', { hasText: 'Oyun ekibinin' }).waitFor();

  // ---------------------------------------------------------------- friends, outside any workspace
  // Arda's own code stands in her Friends window; opening it is what starts her app listening.
  p = arda.page;
  await p.getByRole('button', { name: L.friends.title, exact: true }).click();
  dialog = p.getByRole('dialog', { name: L.friends.title });
  const ownCode = dialog.getByRole('textbox', { name: L.friends.myCode, exact: true });
  await ownCode.waitFor({ timeout: 20_000 });
  const friendCode = await ownCode.inputValue();
  assert.ok(friendCode.startsWith('RUMPUSF1.'), friendCode);
  await dialog.getByText(L.friends.none).waitFor();
  await p.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });

  p = kaan.page;
  await p.getByRole('button', { name: L.friends.title, exact: true }).click();
  dialog = p.getByRole('dialog', { name: L.friends.title });
  // Something that is no friend code is refused in words.
  await dialog.getByLabel(L.friends.theirCode).fill('merhaba');
  await dialog.getByRole('button', { name: L.friends.send }).click();
  await dialog.getByText(L.errors.bad_friend_code).waitFor();
  await dialog.getByLabel(L.friends.theirCode).fill(friendCode);
  await dialog.getByRole('button', { name: L.friends.send }).click();
  await dialog.getByRole('list', { name: L.friends.sent }).getByText('Arda').waitFor();
  await kaan.shot('friends-sent');
  await p.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });

  // The rail's button says that a request waits; Arda accepts and opens the conversation.
  p = arda.page;
  await p.getByRole('button', { name: new RegExp(`^${L.friends.title} · `) }).click({ timeout: 20_000 });
  dialog = p.getByRole('dialog', { name: L.friends.title });
  const asks = dialog.getByRole('list', { name: L.friends.requests });
  await asks.getByText('Kaan').waitFor();
  await arda.shot('friends-request');
  await asks.getByRole('button', { name: L.friends.accept }).click();
  const friendsList = dialog.getByRole('list', { name: L.friends.list });
  await friendsList.getByText('Kaan').waitFor();
  await friendsList.getByRole('button', { name: L.friends.message }).click();
  await dialog.waitFor({ state: 'detached' });
  await p.getByRole('heading', { name: 'Kaan', exact: true }).waitFor();
  await p.getByText(L.friends.direct).waitFor();
  // Two people: nothing to invite anyone into.
  assert.equal(await p.getByRole('button', { name: L.shell.invite }).count(), 0);
  const ardaBox = p.getByRole('textbox', { name: 'Mesaj · #sohbet' });
  await ardaBox.fill('Selam Kaan');
  await ardaBox.press('Enter');

  // ---------------------------------------------------------------- an invite as a card
  p = kaan.page;
  await p.getByRole('button', { name: L.shell.invite }).click();
  dialog = p.getByRole('dialog', { name: L.invite.title });
  await dialog.getByRole('button', { name: L.invite.make }).click();
  const codeBox = dialog.getByRole('textbox', { name: L.invite.code });
  await codeBox.waitFor();
  const code = await codeBox.inputValue();
  await p.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  // Kaan's app heard Arda's yes: the conversation stands in the rail, round, under the friends button, and
  // marked for her message.
  await p.getByRole('button', { name: `Arda · ${L.workspaces.news}` }).click({ timeout: 40_000 });
  await p.getByRole('heading', { name: 'Arda', exact: true }).waitFor();
  await p.locator('.msg', { hasText: 'Selam Kaan' }).waitFor({ timeout: 30_000 });
  // The invite goes into the conversation. On the inviter's side the card says the workspace is already here.
  const kaanBox = p.getByRole('textbox', { name: 'Mesaj · #sohbet' });
  await kaanBox.fill(code);
  await kaanBox.press('Enter');
  let invite = p.locator('.invcard');
  await invite.getByText('Ekip', { exact: true }).waitFor();
  await invite.getByText(L.inviteCard.joined).waitFor();
  await invite.getByRole('button', { name: L.inviteCard.open }).waitFor();
  // The code itself is not shown where its card stands.
  assert.equal(await p.locator('.msg', { has: invite }).locator('.md').count(), 0);
  await kaan.shot('invite-own');

  // Arda gets it in the conversation: the card shows the workspace as Kaan's app describes it, and Kaan with
  // his picture as the one who wrote it.
  p = arda.page;
  invite = p.locator('.invcard');
  await invite.getByText('Ekip', { exact: true }).waitFor({ timeout: 20_000 });
  await invite.locator('.invcard__icon img').waitFor();
  await invite.getByText('Oyun ekibinin çalışma alanı.').waitFor();
  await invite.getByText(L.inviteCard.members_one.replace('{{count}}', '1')).waitFor();
  await p.locator('.msg', { has: invite }).locator('.l-avatar img').waitFor({ timeout: 40_000 });
  await arda.shot('invite');
  await invite.getByRole('button', { name: L.inviteCard.join }).click();
  await invite.getByText(L.inviteCard.waiting).waitFor();
  await p.getByRole('button', { name: `Ekip · ${L.workspaces.state.joining}` }).waitFor();

  // The request waits in the workspace it is for.
  p = kaan.page;
  await p.getByRole('button', { name: /^Ekip/ }).click();
  const requests = p.getByRole('list', { name: L.invite.requests });
  await requests.getByText('Arda').waitFor({ timeout: 20_000 });
  await requests.getByRole('button', { name: L.invite.approve }).click();

  // ---------------------------------------------------------------- each as the other sees them
  p = arda.page;
  // The card follows: once the request is approved the workspace is here, and the card opens it.
  await invite.getByRole('button', { name: L.inviteCard.open }).click({ timeout: 40_000 });
  await p.getByRole('heading', { name: 'Ekip', exact: true }).waitFor();
  await p.getByRole('button', { name: 'Ekip', exact: true }).locator('img').waitFor({ timeout: 30_000 });
  const members = p.getByRole('list', { name: L.shell.members });
  const kaanRow = members.locator('.who', { hasText: 'Kaan' });
  // Kaan's picture came over from his computer; his status stands under his name, which is in his color.
  await kaanRow.locator('.l-avatar img').waitFor({ timeout: 40_000 });
  await kaanRow.getByText('derleme bekliyor').waitFor();
  await kaanRow.locator('b.named').waitFor();
  await kaanRow.getByRole('button', { name: of(L.profile.open, { name: 'Kaan' }) }).click();
  card = p.getByRole('dialog', { name: of(L.profile.of, { name: 'Kaan' }) });
  await card.getByText('Kahve içer.').waitFor();
  await card.getByText(L.shell.role.admin, { exact: true }).waitFor();
  // Arda is no admin: nothing to give or take on someone's card, and no editing of another's profile.
  assert.equal(await card.getByRole('button', { name: 'Tasarım' }).count(), 0);
  assert.equal(await card.getByRole('button', { name: L.profile.edit }).count(), 0);
  await arda.shot('kaan-card');
  await p.keyboard.press('Escape');
  await card.waitFor({ state: 'detached' });
  // The workspace's own dialog is open to everyone and says who may change it.
  await p.getByRole('button', { name: L.wsForm.open }).click();
  dialog = p.getByRole('dialog', { name: L.wsForm.title });
  await dialog.getByText(L.wsForm.adminOnly).waitFor();
  await dialog.getByText('Tasarım').waitFor();
  assert.equal(await dialog.getByLabel(L.wsForm.name, { exact: true }).count(), 0);
  await p.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });

  await p.getByRole('button', { name: /^genel/ }).click();
  const teamBox = p.getByRole('textbox', { name: 'Mesaj · #genel' });
  await teamBox.fill('Merhaba, ben Arda');
  await teamBox.press('Enter');

  // Kaan gives Arda the role from her card; her name takes its color and the list groups her under it.
  p = kaan.page;
  await p.locator('.msg', { hasText: 'Merhaba, ben Arda' }).waitFor({ timeout: 30_000 });
  await p
    .locator('.msg', { hasText: 'Merhaba, ben Arda' })
    .getByRole('button', { name: of(L.profile.open, { name: 'Arda' }) })
    .first()
    .click();
  card = p.getByRole('dialog', { name: of(L.profile.of, { name: 'Arda' }) });
  const toggle = card.getByRole('button', { name: 'Tasarım' });
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  await toggle.click();
  await card.locator('.rolechip--toggle[aria-pressed="true"]').waitFor();
  await kaan.shot('arda-card');
  await p.keyboard.press('Escape');
  await card.waitFor({ state: 'detached' });
  const kaanMembers = p.getByRole('list', { name: L.shell.members });
  await kaanMembers.locator('.crew__group', { hasText: 'Tasarım' }).waitFor();
  await p.locator('.msg', { hasText: 'Merhaba, ben Arda' }).locator('b.named').waitFor();
  await kaan.shot('members');

  p = arda.page;
  await members.locator('.crew__group', { hasText: 'Tasarım' }).waitFor({ timeout: 30_000 });
  await arda.shot('members');

  // A new name in Arda's profile reaches Kaan's list and her earlier message.
  await p
    .getByRole('complementary', { name: L.shell.channels })
    .getByRole('button', { name: L.shell.settings })
    .click();
  dialog = p.getByRole('dialog', { name: L.settings.title });
  await dialog.getByRole('button', { name: L.settings.tabs.profile }).click();
  const name = dialog.getByLabel(L.profile.name);
  await name.fill('Arda B.');
  await name.press('Enter');
  await p.keyboard.press('Escape');
  await kaanMembers.getByText('Arda B.').waitFor({ timeout: 30_000 });
  await kaan.page.locator('.msg', { hasText: 'Merhaba, ben Arda' }).getByText('Arda B.').waitFor();

  assert.deepEqual(kaan.errors, [], kaan.errors.join('\n'));
  assert.deepEqual(arda.errors, [], arda.errors.join('\n'));
  console.log('profiles e2e ok');
} catch (err) {
  // What each window showed when it went wrong.
  await kaan.shot('failed').catch(() => {});
  await arda.shot('failed').catch(() => {});
  console.error([...kaan.errors, ...arda.errors].join(' | '));
  throw err;
} finally {
  await kaan.app.close().catch(() => {});
  await arda.app.close().catch(() => {});
  rmSync(kaan.dir, { recursive: true, force: true });
  rmSync(arda.dir, { recursive: true, force: true });
}
