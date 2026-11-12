// Renders the reel to marketing/out/rumpus-reel-<lang>.mp4: opens reel.html in the installed Chrome, sets its
// clock frame by frame, and hands the frames and the soundtrack to ffmpeg (which must be on the PATH).
// Usage: node marketing/reel/render.mjs [tr|en] [--still <seconds> ...]
//   --still writes single frames (out/reel-<lang>-<seconds>.png) instead of the video, to check a moment.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { serve } from '../render.mjs';
import { DURATION, FPS, HEIGHT, WIDTH } from './timeline.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'out');
const args = process.argv.slice(2);
const lang = args[0] === 'en' ? 'en' : 'tr';
const stillAt = args.includes('--still') ? args.slice(args.indexOf('--still') + 1).map(Number) : null;

const { server, base } = await serve();
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto(`${base}/marketing/reel/reel.html?render&lang=${lang}`);
await page.waitForSelector('html[data-ready]');

if (stillAt) {
  for (const s of stillAt) {
    await page.evaluate((ms) => window.seek(ms), s * 1000);
    const file = join(out, `reel-${lang}-${s.toFixed(2)}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
} else {
  const audio = join(out, 'reel-audio.wav');
  if (!existsSync(audio)) throw new Error('No soundtrack: run `node marketing/reel/audio.mjs` first.');
  const file = join(out, `rumpus-reel-${lang}.mp4`);
  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-framerate',
      String(FPS),
      '-c:v',
      'png',
      '-i',
      '-',
      '-i',
      audio,
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '15',
      '-pix_fmt',
      'yuv420p',
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-t',
      String(DURATION),
      '-movflags',
      '+faststart',
      file,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const frames = Math.round(DURATION * FPS);
  const started = Date.now();
  for (let f = 0; f < frames; f++) {
    await page.evaluate((ms) => window.seek(ms), (f / FPS) * 1000);
    const png = await page.screenshot({ type: 'png' });
    if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
    if (f % 60 === 0) console.log(`frame ${f} / ${frames}`);
  }
  ffmpeg.stdin.end();
  await new Promise((resolve, reject) => {
    ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
  });
  console.log(`${file}  ${frames} frames in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
await browser.close();
server.close();
