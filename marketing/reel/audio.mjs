// The reel's soundtrack, synthesized here so that nothing in it is anyone else's recording: a beat at 120 BPM
// from the reveal on, and a sound for everything that happens on screen (timeline.js). Writes
// marketing/out/reel-audio.wav (44.1 kHz, stereo, 16 bit). Usage: node marketing/reel/audio.mjs [--token]
//   --token writes out/token-music.wav for the reel that opens with the game clip: only the beat, from that
//           reel's reveal on, and no sound per event (the clip brings its own sound for the opening).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BPM, DURATION, events, SCENES, TOKEN_DURATION, TOKEN_SHIFT } from './timeline.js';

const token = process.argv.includes('--token');
/** In the token reel everything after the opening is this much later. */
const shift = token ? TOKEN_SHIFT : 0;

const RATE = 44100;
const TAIL = 0.6;
const N = Math.ceil(((token ? TOKEN_DURATION : DURATION) + TAIL) * RATE);
const L = new Float32Array(N);
const R = new Float32Array(N);
const TAU = Math.PI * 2;

let seed = 1234567;
const noise = () => {
  seed = (seed * 1664525 + 1013904223) | 0;
  return (seed >>> 0) / 2147483648 - 1;
};

/** Adds `fn(t, i)` (t in seconds from `at`) for `dur` seconds, with a gain and a pan from -1 to 1. */
function add(at, dur, gain, pan, fn) {
  const start = Math.round(at * RATE);
  const len = Math.round(dur * RATE);
  const gl = gain * Math.min(1, 1 - pan);
  const gr = gain * Math.min(1, 1 + pan);
  for (let i = 0; i < len; i++) {
    const k = start + i;
    if (k < 0 || k >= N) continue;
    const v = fn(i / RATE, i);
    L[k] += v * gl;
    R[k] += v * gr;
  }
}

const decay = (t, tau) => Math.exp(-t / tau);
const note = (n) => 440 * 2 ** ((n - 69) / 12);
/** A band-limited saw-like tone: the first harmonics, each a little quieter. */
const saw = (f, t, harmonics = 6) => {
  let v = 0;
  for (let h = 1; h <= harmonics; h++) v += Math.sin(TAU * f * h * t) / h;
  return v * 0.5;
};

const sounds = {
  kick: (at, gain = 0.9) =>
    add(at, 0.42, gain, 0, (t) => {
      const f = 46 + 110 * decay(t, 0.035);
      return Math.sin(TAU * (46 * t + 110 * 0.035 * (1 - decay(t, 0.035)))) * decay(t, 0.16) + f * 0;
    }),
  hat: (at, gain = 0.1, pan = 0.3) => {
    let prev = 0;
    add(at, 0.05, gain, pan, (t) => {
      const n = noise();
      const hp = n - prev;
      prev = n;
      return hp * decay(t, 0.012);
    });
  },
  clap: (at, gain = 0.28) => {
    let lp = 0;
    add(at, 0.2, gain, 0, (t) => {
      lp += (noise() - lp) * 0.45;
      const env = decay(t, 0.05) + 0.6 * decay(Math.abs(t - 0.012), 0.004) + 0.5 * decay(Math.abs(t - 0.026), 0.004);
      return lp * env;
    });
  },
  bass: (at, midi, dur = 0.24, gain = 0.34) =>
    add(at, dur, gain, 0, (t) => {
      const f = note(midi);
      const env = Math.min(1, t / 0.006) * decay(t, dur * 0.55);
      return (Math.sin(TAU * f * t) + 0.45 * saw(f, t, 4)) * env;
    }),
  pluck: (at, midi, gain = 0.09, pan = 0) =>
    add(at, 0.3, gain, pan, (t) => {
      const f = note(midi);
      return (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * 2 * f * t)) * decay(t, 0.07);
    }),
  blip: (at) =>
    add(at, 0.12, 0.3, -0.1, (t) => {
      const f = 300 + 500 * decay(t, 0.02);
      return Math.sin(TAU * f * t) * decay(t, 0.035);
    }),
  pop: (at) => add(at, 0.1, 0.26, 0.2, (t) => Math.sin(TAU * (420 + 900 * t * 6) * t) * decay(t, 0.03)),
  tick: (at) =>
    add(at, 0.06, 0.2, 0.15, (t) => (Math.sin(TAU * 1900 * t) + 0.5 * Math.sin(TAU * 2850 * t)) * decay(t, 0.012)),
  ding: (at) =>
    add(at, 0.5, 0.2, -0.2, (t) => (Math.sin(TAU * 1318.5 * t) + 0.4 * Math.sin(TAU * 2637 * t)) * decay(t, 0.12)),
  chime: (at) => {
    for (const [dt, n] of [
      [0, 76],
      [0.09, 81],
      [0.18, 88],
    ])
      add(
        at + dt,
        0.6,
        0.17,
        0,
        (t) => (Math.sin(TAU * note(n) * t) + 0.3 * Math.sin(TAU * note(n) * 2 * t)) * decay(t, 0.16),
      );
  },
  whoosh: (at) => {
    let lp = 0;
    add(at - 0.18, 0.5, 0.3, 0, (t) => {
      const x = t / 0.5;
      lp += (noise() - lp) * (0.04 + 0.5 * Math.sin(Math.PI * x) ** 2);
      return lp * Math.sin(Math.PI * x) ** 2;
    });
  },
  riser: (at) => {
    const dur = 1.3;
    let lp = 0;
    add(at, dur, 0.34, 0, (t) => {
      const x = t / dur;
      lp += (noise() - lp) * (0.02 + 0.6 * x * x);
      const tone = Math.sin(TAU * (160 * t + 420 * t * t)) * 0.35;
      return (lp + tone) * x * x;
    });
  },
  impact: (at) => {
    sounds.kick(at, 1.1);
    add(at, 1.4, 0.5, 0, (t) => Math.sin(TAU * 41 * t) * decay(t, 0.45));
    let lp = 0;
    add(at, 0.5, 0.45, 0, (t) => {
      lp += (noise() - lp) * 0.3;
      return lp * decay(t, 0.1);
    });
    // an A minor stab
    for (const [n, pan] of [
      [57, -0.4],
      [60, 0.4],
      [64, -0.2],
      [69, 0.2],
    ])
      add(at, 1.3, 0.1, pan, (t) => saw(note(n), t, 8) * Math.min(1, t / 0.004) * decay(t, 0.3));
  },
};

if (!token) {
  // ---- what happens on screen
  for (const [at, kind] of events()) sounds[kind](at);

  // ---- a low drone under the hook
  add(0, SCENES.reveal[0], 0.1, 0, (t) => {
    const env = Math.min(1, t / 1.5) * (0.75 + 0.25 * Math.sin(TAU * 0.5 * t));
    return (Math.sin(TAU * 55 * t) + 0.5 * Math.sin(TAU * 82.4 * t)) * env;
  });
}

// ---- the beat, from the reveal to the last shout
const beat = 60 / BPM;
const from = SCENES.reveal[0] + shift;
const to = SCENES.end[0] + 2.6 + shift;
const ROOTS = [33, 33, 29, 31]; // A, A, F, G: one per bar
const ARP = [69, 72, 76, 79, 76, 72, 81, 76];
for (let b = 0; from + b * beat < to - 0.01; b++) {
  const at = from + b * beat;
  const bar = Math.floor(b / 4) % ROOTS.length;
  // room for the two impacts, which only the reel with its own sounds has
  const quiet = !token && (b === 0 || (at >= SCENES.more[0] && at < SCENES.more[0] + 0.5));
  if (!quiet) sounds.kick(at, 0.8);
  sounds.hat(at + beat / 2, 0.12, 0.35);
  sounds.hat(at + beat / 4, 0.05, -0.35);
  sounds.hat(at + (3 * beat) / 4, 0.05, -0.35);
  if (b % 2 === 1) sounds.clap(at);
  const root = ROOTS[bar];
  sounds.bass(at, root + 12);
  sounds.bass(at + beat / 2, root + 12, 0.2, 0.26);
  if (b % 4 === 3) sounds.bass(at + (3 * beat) / 4, root + 19, 0.12, 0.22);
  for (let s = 0; s < 4; s++) {
    const n = ARP[(b * 4 + s) % ARP.length] + (bar >= 2 ? ROOTS[bar] - 33 : 0);
    sounds.pluck(at + (s * beat) / 4, n, 0.07, s % 2 ? 0.5 : -0.5);
  }
}

// ---- an echo for width, a soft limit, fades at both ends
const echo = Math.round(0.1875 * RATE);
for (let i = echo; i < N; i++) {
  L[i] += R[i - echo] * 0.16;
  R[i] += L[i - echo] * 0.16;
}
let peak = 0;
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh(L[i] * 1.25);
  R[i] = Math.tanh(R[i] * 1.25);
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const gain = 0.89 / peak;
const fadeOut = Math.round(TAIL * RATE);
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  const fade = Math.min(1, i / 400, (N - i) / fadeOut);
  pcm.writeInt16LE(Math.round(L[i] * gain * fade * 32767), i * 4);
  pcm.writeInt16LE(Math.round(R[i] * gain * fade * 32767), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
mkdirSync(out, { recursive: true });
const file = token ? 'token-music.wav' : 'reel-audio.wav';
writeFileSync(join(out, file), Buffer.concat([header, pcm]));
console.log(`out/${file}  ${(N / RATE).toFixed(2)} s`);
