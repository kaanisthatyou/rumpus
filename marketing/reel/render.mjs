// Renders the reel to marketing/out/rumpus-reel-<lang>.mp4: opens reel.html in the installed Chrome, sets its
// clock frame by frame, and hands the frames and the soundtrack to ffmpeg (which must be on the PATH).
// Usage: node marketing/reel/render.mjs [tr|en] [--hook token] [--still <seconds> ...]
//   --hook token renders the reel that opens with the game clip (token.js) to out/rumpus-token-<lang>.mp4:
//                the clip's own sound for the opening, then only the beat. token-frames.mjs must have cut the
//                clip and `audio.mjs --token` written the beat first.
//   --still writes single frames (out/reel-<lang>-<seconds>.png) instead of the video, to check a moment.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { serve } from '../render.mjs';
import { DURATION, FPS, HEIGHT, TOKEN, TOKEN_DURATION, WIDTH } from './timeline.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'out');
const args = process.argv.slice(2);
const lang = args[0] === 'en' ? 'en' : 'tr';
const token = args[args.indexOf('--hook') + 1] === 'token' && args.includes('--hook');
const name = token ? 'token' : 'reel';
const duration = token ? TOKEN_DURATION : DURATION;
const stillAt = args.includes('--still')
  ? args
      .slice(args.indexOf('--still') + 1)
      .map(Number)
      .filter(Number.isFinite)
  : null;

const { server, base } = await serve();
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto(`${base}/marketing/reel/reel.html?render&lang=${lang}${token ? '&hook=token' : ''}`);
await page.waitForSelector('html[data-ready]');

if (stillAt) {
  for (const s of stillAt) {
    await page.evaluate((ms) => window.seek(ms), s * 1000);
    const file = join(out, `${name}-${lang}-${s.toFixed(2)}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
} else {
  const sound = token ? [join(out, 'token', 'clip.wav'), join(out, 'token-music.wav')] : [join(out, 'reel-audio.wav')];
  for (const s of sound) {
    if (!existsSync(s)) throw new Error(`No sound (${s}): run audio.mjs and, for the token reel, token-frames.mjs.`);
  }
  // The clip's sound goes down while Bub leaves the banner; the beat starts with the scene after it.
  const fadeAt = TOKEN.burst + TOKEN.at.grow;
  const fadeFor = (TOKEN.span[1] - fadeAt).toFixed(2);
  // The beat is turned down so that it does not come in much louder than the game.
  const mix = `[1:a]afade=t=out:st=${fadeAt}:d=${fadeFor}[clip];[2:a]volume=0.6[beat];[clip][beat]amix=inputs=2:normalize=0[a]`;
  const file = join(out, `rumpus-${name}-${lang}.mp4`);
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
      ...sound.flatMap((s) => ['-i', s]),
      ...(token ? ['-filter_complex', mix, '-map', '0:v', '-map', '[a]'] : []),
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
      String(duration),
      '-movflags',
      '+faststart',
      file,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const frames = Math.round(duration * FPS);
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
