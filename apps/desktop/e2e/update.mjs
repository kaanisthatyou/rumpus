// Update test of the packaged app: the installed build finds a newer release on a local feed, downloads it
// and offers the restart. It stops before installing, so nothing is installed on this computer.
// Needs: release/win-unpacked (the current version) and release-next/ (a newer build plus latest.yml):
//   pnpm dist
//   pnpm exec electron-builder --config electron-builder.yml --publish never
//        -c.extraMetadata.version=<newer> -c.directories.output=release-next
//   node e2e/update.mjs
import assert from 'node:assert/strict';
import { createReadStream, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const feedDir = join(appDir, 'release-next');
const next = /version: (\S+)/.exec(readFileSync(join(feedDir, 'latest.yml'), 'utf8'))?.[1];
assert.ok(next, 'release-next/latest.yml has no version');
const L = JSON.parse(readFileSync(join(appDir, 'src/renderer/src/locales/en.json'), 'utf8'));

const requests = [];
const server = createServer((req, res) => {
  const file = join(feedDir, basename(decodeURIComponent((req.url ?? '/').split('?')[0])));
  requests.push(basename(file));
  try {
    const size = statSync(file).size;
    res.writeHead(200, { 'Content-Length': size });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const home = mkdtempSync(join(tmpdir(), 'lonca-update-'));
writeFileSync(
  join(home, 'settings.json'),
  JSON.stringify({
    v: 1,
    language: 'en',
    theme: 'dark',
    accent: 'lime',
    motion: 'system',
    profile: { name: 'Test' },
    dataDir: '',
    onboarded: true,
  }),
);

const app = await electron.launch({
  executablePath: join(appDir, 'release/win-unpacked/Serai.exe'),
  env: { ...process.env, LONCA_HOME: home, LONCA_LANG: 'en', LONCA_UPDATE_URL: `http://127.0.0.1:${port}/` },
});
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: L.shell.crew }).waitFor();
  await page.keyboard.press('Control+Comma');
  await page.getByRole('button', { name: L.settings.tabs.updates }).click();
  await page.getByRole('button', { name: L.update.check }).click();
  const ready = L.update.ready.replace('{{version}}', next);
  await page.getByText(ready).first().waitFor({ timeout: 180_000 });
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'),
  );
  writeFileSync(join(appDir, 'test-results', 'update-ready.png'), Buffer.from(png, 'base64'));
  assert.ok(requests.includes('latest.yml'));
  assert.ok(
    requests.some((r) => r.endsWith('.exe')),
    `installer not downloaded: ${requests.join(', ')}`,
  );
  console.log(`update ok: found and downloaded ${next} (${requests.join(', ')})`);
} finally {
  await app.close();
  server.close();
}
