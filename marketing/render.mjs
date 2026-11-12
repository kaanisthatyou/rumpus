// Renders every poster of posters.html to marketing/out/<name>-<lang>.png with the installed Chrome.
// Usage: node marketing/render.mjs [name ...]
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, 'out');
mkdirSync(out, { recursive: true });

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
};

/** The repository over http on a free loopback port: the pages are ES modules, which a file: page cannot load. */
export function serve() {
  const server = createServer((req, res) => {
    const file = join(root, normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const wanted = process.argv.slice(2);
  const { server, base } = await serve();
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 2000 } });
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto(`${base}/marketing/posters.html`);
  await page.waitForSelector('html[data-ready]');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  for (const el of await page.$$('.p')) {
    const id = await el.getAttribute('data-id');
    if (wanted.length && !wanted.some((w) => id.startsWith(w))) continue;
    await el.screenshot({ path: join(out, `${id}.png`) });
    console.log(`out/${id}.png`);
  }
  await browser.close();
  server.close();
}
