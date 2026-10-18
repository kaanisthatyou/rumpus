// Opt-in end-to-end test with the real Claude Code on this computer (it spends a little quota: a handful of short
// turns on Haiku). It adds an agent, asks about a README, has the agent move a board card with Lonca's own MCP
// tools, then runs a small goal with a done check. Run by hand after `electron-vite build`: node e2e/real-claude.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const L = JSON.parse(readFileSync(join(appDir, 'src/renderer/src/locales/tr.json'), 'utf8'));
const shots = join(appDir, 'test-results');
mkdirSync(shots, { recursive: true });
const home = mkdtempSync(join(tmpdir(), 'lonca-real-'));
const project = mkdtempSync(join(tmpdir(), 'lonca-real-project-'));
writeFileSync(
  join(project, 'README.md'),
  '# Kumbara\n\nKumbara, harcamaları kategorilere ayıran küçük bir bütçe uygulamasıdır.\n',
);
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

const app = await electron.launch({
  executablePath: createRequire(import.meta.url)('electron'),
  args: [appDir],
  env: { ...process.env, LONCA_HOME: home, LONCA_LANG: 'tr' },
});
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await app.evaluate(({ dialog }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
}, project);
const shot = async (name) => {
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'),
  );
  writeFileSync(join(shots, `real-${name}.png`), Buffer.from(png, 'base64'));
};
const until = async (fn, what, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out: ${what}`);
};

try {
  await page.getByRole('heading', { name: L.shell.crew }).waitFor();
  await page.getByRole('button', { name: L.crew.add, exact: true }).click();
  await page.getByRole('button', { name: L.agentForm.pick, exact: true }).click();
  await page.getByLabel(L.agentForm.model).fill('haiku');
  await page.getByText(L.agentForm.modes.edit, { exact: true }).click();
  await page.getByRole('button', { name: L.agentForm.save }).click();
  await page.getByRole('button', { name: '@claude', exact: true }).waitFor();

  await page.getByRole('button', { name: 'genel', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Mesaj · #genel' });
  await composer.fill('@claude README.md dosyası ne anlatıyor? Tek cümleyle yanıtla.');
  await composer.press('Enter');
  await until(async () => (await page.locator('.msg--agent').count()) >= 1, 'first answer', 180_000);
  const first = await page.locator('.msg--agent').first().innerText();
  console.log('answer 1:', first.replace(/\s+/g, ' ').slice(0, 200));
  assert.match(first, /bütçe|harcama|Kumbara/i);
  await shot('answer');

  await composer.fill('/todo Kategorileri gözden geçir @claude');
  await composer.press('Enter');
  await page.getByText(L.board.added).waitFor();
  await composer.fill(
    '@claude Lonca araçlarından list_cards ile panodaki kartları listele, sonra o kartı update_card ile review durumuna al. Kısa yanıtla.',
  );
  await composer.press('Enter');
  await until(async () => (await page.locator('.msg--agent').count()) >= 2, 'second answer', 180_000);
  await page.getByText('lonca.update_card').first().waitFor();
  await shot('mcp');
  await page.getByRole('button', { name: L.shell.tasks, exact: true }).click();
  await page.getByRole('region', { name: L.board.status.review }).getByText('Kategorileri gözden geçir').waitFor();
  await shot('board');

  // A small goal: a plan from the real CLI, approved, worked on, and checked.
  await page.getByRole('button', { name: 'genel', exact: true }).click();
  await composer.fill(
    "/goal README.md dosyasının en sonuna tek başına 'Lisans: MIT' satırını ekle. Başka bir şeyi değiştirme.",
  );
  await composer.press('Enter');
  const goalDialog = page.getByRole('dialog', { name: L.goal.new });
  await goalDialog.getByLabel(L.goal.maxSteps, { exact: true }).fill('4');
  await goalDialog
    .getByLabel(L.goal.check, { exact: true })
    .fill(`node -e "process.exit(require('fs').readFileSync('README.md','utf8').includes('Lisans: MIT')?0:1)"`);
  await goalDialog.getByRole('button', { name: L.goal.start }).click();
  const goalCard = page.getByRole('region', { name: L.goal.title });
  await goalCard.getByText(L.goal.state.review).waitFor({ timeout: 180_000 });
  const plan = await goalCard.locator('.goalstep__text').allInnerTexts();
  console.log('plan:', plan);
  assert.ok(plan.length >= 1);
  await goalCard.getByRole('button', { name: L.goal.approve, exact: true }).click();
  // A person stands by: approvals the steps ask for are allowed; a pause or a stop ends the test.
  const end = Date.now() + 300_000;
  for (;;) {
    if (await goalCard.getByText(L.goal.state.done, { exact: true }).isVisible()) break;
    const allow = page.getByRole('button', { name: L.job.approval.allow });
    if (await allow.isVisible()) {
      console.log(
        'approval:',
        (
          await page
            .locator('.job__approval, .approval')
            .first()
            .innerText()
            .catch(() => '')
        ).replace(/\s+/g, ' '),
      );
      await allow.click();
    }
    const state = await goalCard.locator('.goal__state').innerText();
    if ([L.goal.state.paused, L.goal.state.stopped, L.goal.state.failed].includes(state.trim()) || Date.now() > end) {
      await shot('goal-stuck');
      throw new Error(`goal ended as ${state}: ${(await goalCard.innerText()).replace(/\s+/g, ' ')}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.match(readFileSync(join(project, 'README.md'), 'utf8'), /Lisans: MIT/);
  await shot('goal');
  assert.deepEqual(errors, []);
  console.log('real claude e2e ok');
} finally {
  await app.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
}
