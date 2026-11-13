// The reel's other opening (reel.html?hook=token), in place of the two Discord scenes: a game clip runs with
// nothing over it, as if the video were about the game, until the game's gold burst; where the game then shows
// its own "you found" banner, ours says Rumpus, with Bub as the item. The banner turns from the game's gold to
// lime, Bub grows out of it, and the reel goes on. The clip is not in the repository: token-frames.mjs cuts it
// into marketing/out/token/f-001.jpg ... (see marketing/README.md).
import { FPS, HEIGHT, TOKEN, WIDTH } from './timeline.js';

const TEXT = {
  tr: { sub: 'Nadir değil. Açık kaynak, herkese.' },
  en: { sub: 'Not rare. Open source, for everyone.' },
};

/** The game's own words stay English in both languages, as in the clip. */
const FOUND = 'YOU FOUND';

/** How long the scene stays under the next one coming in. */
const HOLD = 0.5;

/** How many frames the clip has: the whole scene, and the moment the next one takes to cover it. */
export const CLIP_FRAMES = Math.round((TOKEN.span[1] - TOKEN.span[0] + HOLD) * FPS);

/** The scene. `bub` and `burst` are reel.js's own pieces. */
export function tokenScene({ lang, bub, burst }) {
  const t = TEXT[lang];
  const [a, b] = TOKEN.span;
  const s = TOKEN.burst;
  const at = TOKEN.at;
  const vars = `--t0:${a}s;--t0s:${a}s;--t1:${b + HOLD}s;--len:${b - a}s;--burst:${s}s;--to-lime:${s + at.lime}s;--grow:${s + at.grow}s`;
  const canvas = (id) => `<canvas id="${id}" width="${WIDTH}" height="${HEIGHT}"></canvas>`;
  return `<section class="sc sc--token" style="${vars}"><div class="sc__in">
    <div class="tk__clip">${canvas('clip')}</div>
    <div class="tk__haze">${canvas('haze')}</div>
    <div class="tk__dim"></div>
    <div class="tk__rays"></div>
    <div class="tk__glow"></div>
    <div class="tk__ban">
      <div class="tk__title" style="--d:${s + at.title}s">RUMPUS</div>
      <div class="tk__bar" style="--d:${s + at.name}s"></div>
      <div class="tk__plate" style="--d:${s + at.emblem}s"></div>
      <div class="tk__found" style="--d:${s + at.found}s">${FOUND}</div>
      <div class="tk__name" style="--d:${s + at.name}s">RUMPUS</div>
      <div class="tk__sub" style="--d:${s + at.sub}s">${t.sub}</div>
    </div>
    <div class="tk__rise" style="--d:${s + at.emblem}s">${bub({ left: 250, top: 420, width: 620, d: s + at.emblem, shout: s + at.grow + 0.75, cls: 'bub--lime' })}</div>
    ${burst({ x: 560, y: 720, d: s + at.grow + 0.2, n: 48, seed: 23, colors: ['#c6f24e', '#ffd84a', '#e9ecf1'] })}
  </div></section>`;
}

/**
 * Loads the clip's frames and returns what draws the one that belongs to a time on the reel's clock (ms). The
 * frames stay as they came (a few hundred opened pictures would not fit in memory) and each is opened when it is
 * drawn, so drawing takes a moment: the renderer waits for it. From the burst on, the frame is also drawn into
 * the blurred copy that hides the game's own banner.
 */
export async function loadClip() {
  const ctx = document.getElementById('clip').getContext('2d');
  const haze = document.getElementById('haze').getContext('2d');
  const frames = await Promise.all(
    Array.from({ length: CLIP_FRAMES }, (_, i) => {
      const img = new Image();
      img.src = `../out/token/f-${String(i + 1).padStart(3, '0')}.jpg`;
      return new Promise((resolve) => {
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
      });
    }),
  );
  if (frames.includes(null)) {
    ctx.fillStyle = '#e9ecf1';
    ctx.font = '600 40px sans-serif';
    ctx.fillText('No clip: run marketing/reel/token-frames.mjs', 60, 960);
    return async () => {};
  }
  let shown = -1;
  return async (ms) => {
    const seconds = ms / 1000 - TOKEN.span[0];
    const i = Math.max(0, Math.min(CLIP_FRAMES - 1, Math.floor(seconds * FPS + 1e-6)));
    if (i === shown) return;
    shown = i;
    await frames[i].decode();
    if (shown !== i) return;
    ctx.drawImage(frames[i], 0, 0, WIDTH, HEIGHT);
    if (seconds > TOKEN.burst - 0.3) haze.drawImage(frames[i], 0, 0, WIDTH, HEIGHT);
  };
}
