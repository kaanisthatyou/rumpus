// Cuts the game clip of the reel's "token" opening into the frames the page draws and takes its sound
// (marketing/out/token/, which git ignores: the clip is someone else's recording and never goes into the
// repository).
// Usage: node marketing/reel/token-frames.mjs <clip> --burst <seconds> [--crop w:h:x:y]
//   --burst when, in the clip, the game's gold burst is at its fullest, just before its banner forms. The reel
//           has that moment at `TOKEN.burst`, so the clip needs at least that many seconds before it.
//   --crop  the upright part of the picture to keep (ffmpeg's crop): the banner in its middle, and no streamer's
//           camera, chat or captions
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FPS, HEIGHT, TOKEN, WIDTH } from './timeline.js';
import { CLIP_FRAMES } from './token.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const clip = args[0];
const burst = Number(flag('--burst', Number.NaN));
const crop = flag('--crop', '546:970:687:0');
const from = burst - TOKEN.burst;
if (!clip || !Number.isFinite(burst) || from < 0) {
  console.error('Usage: node marketing/reel/token-frames.mjs <clip> --burst <seconds> [--crop w:h:x:y]');
  if (from < 0) console.error(`The clip needs ${TOKEN.burst} s before the burst; this one has ${burst} s.`);
  process.exit(1);
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'out', 'token');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const done = spawnSync(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    from.toFixed(4),
    '-i',
    clip,
    '-vf',
    `fps=${FPS},crop=${crop},scale=${WIDTH}:${HEIGHT}:flags=lanczos,unsharp=5:5:0.5`,
    '-frames:v',
    String(CLIP_FRAMES),
    '-q:v',
    '2',
    join(out, 'f-%03d.jpg'),
  ],
  { stdio: 'inherit' },
);
if (done.status !== 0) process.exit(done.status ?? 1);
// The clip's own sound for the same stretch; the renderer fades it out as the opening ends. Clips come at any
// loudness (one was 17 dB under full), so its loudest moment is brought to 2 dB under full.
const stretch = ['-ss', from.toFixed(4), '-i', clip, '-t', (CLIP_FRAMES / FPS).toFixed(4), '-vn'];
const heard = spawnSync('ffmpeg', ['-hide_banner', ...stretch, '-af', 'volumedetect', '-f', 'null', '-'], {
  encoding: 'utf8',
});
const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(heard.stderr ?? '')?.[1] ?? Number.NaN);
const gain = Number.isFinite(peak) ? -2 - peak : 0;
const sound = spawnSync(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    ...stretch,
    '-af',
    `volume=${gain.toFixed(1)}dB`,
    '-ar',
    '44100',
    '-ac',
    '2',
    join(out, 'clip.wav'),
  ],
  { stdio: 'inherit' },
);
if (sound.status !== 0) process.exit(sound.status ?? 1);
console.log(`${readdirSync(out).length - 1} frames and clip.wav in ${out} (from ${from.toFixed(3)} s of the clip)`);
