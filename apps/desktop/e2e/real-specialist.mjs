// Opt-in probe of a specialist with the real Claude Code on this computer (it spends a little quota: one job on
// Haiku). It makes a code reviewer from the template, writes two messages in #genel, asks the specialist to look
// at a small project, and checks what only a real model can show: it read the channel, it ended with a RESULT line
// that Serai took out of the chat, and (reported, not required) it kept a lesson.
// Run by hand after `electron-vite build`: node e2e/real-specialist.mjs
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
const L = locale('tr');
const shots = join(appDir, 'test-results');
mkdirSync(shots, { recursive: true });
const home = mkdtempSync(join(tmpdir(), 'lonca-real-spec-'));
const project = mkdtempSync(join(tmpdir(), 'lonca-real-spec-project-'));
writeFileSync(
  join(project, 'README.md'),
  '# Kumbara\n\nKumbara, harcamaları kategorilere ayıran küçük bir bütçe uygulamasıdır.\n\nTestler: `node test.js`\n',
);
writeFileSync(
  join(project, 'toplam.js'),
  [
    '// Harcamaların toplamını verir.',
    'function toplam(harcamalar) {',
    '  let t = 0;',
    '  for (let i = 0; i <= harcamalar.length; i++) t += harcamalar[i].tutar;',
    '  return t;',
    '}',
    'module.exports = { toplam };',
    '',
  ].join('\n'),
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
  await page.waitForTimeout(500);
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'),
  );
  writeFileSync(join(shots, `real-spec-${name}.png`), Buffer.from(png, 'base64'));
};

try {
  await page.getByRole('heading', { name: L.shell.crew }).waitFor();
  const composer = page.getByRole('textbox', { name: 'Mesaj · #genel' });
  await composer.fill('toplam.js dosyasını dün ben yazdım, acele oldu.');
  await composer.press('Enter');
  await composer.fill('Bu projede testler `node test.js` ile çalışır, ama test dosyası henüz yok.');
  await composer.press('Enter');

  // A reviewer from the template, on Haiku.
  await page.getByRole('button', { name: L.specialists.new, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: L.specialists.new });
  await dialog.getByText(L.specialists.templates.reviewer.name, { exact: true }).click();
  await dialog.getByRole('button', { name: L.agentForm.pick, exact: true }).click();
  await dialog.getByText(project).waitFor();
  await dialog.getByLabel(L.agentForm.model, { exact: true }).fill('haiku');
  await dialog.getByRole('button', { name: L.agentForm.save }).click();
  await dialog.waitFor({ state: 'detached' });

  await composer.fill(
    '@inceleme toplam.js dosyasını incele. Bu proje hakkında sonraki işlerde de işe yarayacak bir şey öğrenirsen ders olarak tut.',
  );
  await composer.press('Enter');
  const started = Date.now();
  await page.locator('.job__budget').waitFor({ timeout: 60_000 });
  // The job ends on its own, well inside the template's 15 minutes.
  await page.locator('.msg--agent').last().waitFor({ timeout: 300_000 });
  await page.locator('.job--done, .job--failed, .job--stopped').last().waitFor({ timeout: 300_000 });
  await shot('answer');

  const state = await page.locator('.job').last().getAttribute('class');
  const answer = await page.locator('.msg--agent').last().innerText();
  const results = await page.locator('.result').count();
  const resultText = results ? await page.locator('.result').last().innerText() : '';
  const steps = await page.locator('.job').last().locator('.step').allInnerTexts();
  const learned = await page
    .getByRole('complementary', { name: L.shell.crew })
    .locator('.who__learned')
    .allInnerTexts();
  console.log(
    JSON.stringify(
      {
        seconds: Math.round((Date.now() - started) / 1000),
        job: state,
        steps,
        answer: answer.slice(0, 1200),
        result: resultText,
        lessonsKept: learned,
        rawResultLineInChat: /RESULT\s*\{/.test(answer),
      },
      null,
      2,
    ),
  );
  assert.match(state ?? '', /job--done/);
  assert.equal(results > 0, true, 'the RESULT line was parsed into a result block');
  assert.equal(/RESULT\s*\{/.test(answer), false, 'the RESULT line is not in the chat text');
  assert.deepEqual(errors, []);
  console.log('real specialist probe ok');
} catch (err) {
  await shot('failed').catch(() => {});
  console.error(errors.join('\n'));
  throw err;
} finally {
  await app.close();
  for (const dir of [home, project]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // a still-open handle on Windows: the temp folder is cleaned up by the OS later
    }
  }
}
