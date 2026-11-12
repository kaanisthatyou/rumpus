// The reel's clock: when each scene starts and ends (seconds, cut on the beat of 120 BPM) and when the things
// that make a sound happen. The page (reel.js) and the soundtrack (audio.mjs) both read it, so they stay in step.

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const BPM = 120;

/** How much faster than on the site the app window's scenes run. */
export const K = 0.55;
/** The same for the team scene, which has less time. */
export const K_TEAM = 0.4;

export const SCENES = {
  hookA: [0, 2.5],
  hookB: [2.5, 6],
  reveal: [6, 8.5],
  demo: [8.5, 13.5],
  race: [13.5, 17],
  team: [17, 20],
  handover: [20, 23],
  more: [23, 26.5],
  end: [26.5, 30.5],
};

export const DURATION = SCENES.end[1];

/** Offsets inside each scene, in seconds. */
export const AT = {
  hookA: { words: [0.25, 0.85], typing: 1.5 },
  hookB: { words: [0.1, 0.6, 0.9, 1.4, 1.9], rows: [1.6, 1.9, 2.3, 2.6] },
  reveal: { bub: 0.12, word: 0.45, line: 1.15 },
  demo: { win: 0.25, steps: [2.0, 2.8, 3.7, 4.8, 5.8].map((s) => s * K), done: 6.6 * K },
  race: { win: 0.2, finish: [3.6 * K, 4.9 * K], ready: 5.2 * K },
  team: { win: 0.15, steps: [2.0, 2.9, 3.7].map((s) => s * K_TEAM), done: 4.4 * K_TEAM, note: 1.5 },
  handover: { nodes: [0.2, 0.75, 0.9], send: 0.95, done: [1.6, 1.85], back: 1.95, note: 2.15 },
  more: { title: 0.05, chips: Array.from({ length: 9 }, (_, i) => 0.6 + i * 0.26) },
  end: { bub: 0.15, word: 0.5, line: 1.1, shout: 2.6 },
};

/** When the picture shakes: the reveal, the list of what else is in it, the last shout. */
export const SHAKES = [SCENES.reveal[0], SCENES.more[0], SCENES.end[0] + AT.end.shout];

/** Every sound, as [time, kind]: the soundtrack is built from this list. */
export function events() {
  const out = [];
  const add = (scene, offset, kind) => out.push([SCENES[scene][0] + offset, kind]);
  for (const t of AT.hookA.words) add('hookA', t, 'blip');
  add('hookA', AT.hookA.typing, 'tick');
  for (const t of AT.hookB.words) add('hookB', t, 'blip');
  for (const t of AT.hookB.rows) add('hookB', t, 'pop');
  out.push([SCENES.reveal[0] - 1.3, 'riser']);
  add('reveal', 0, 'impact');
  add('demo', 0, 'whoosh');
  for (const t of AT.demo.steps) add('demo', AT.demo.win + t, 'tick');
  add('demo', AT.demo.win + AT.demo.done, 'chime');
  add('race', 0, 'whoosh');
  for (const t of AT.race.finish) add('race', AT.race.win + t, 'ding');
  add('race', AT.race.win + AT.race.ready, 'chime');
  add('team', 0, 'whoosh');
  for (const t of AT.team.steps) add('team', AT.team.win + t, 'tick');
  add('team', AT.team.win + AT.team.done, 'chime');
  add('handover', 0, 'whoosh');
  for (const t of AT.handover.nodes) add('handover', t, 'pop');
  add('handover', AT.handover.send, 'blip');
  for (const t of AT.handover.done) add('handover', t, 'ding');
  add('handover', AT.handover.back + 0.45, 'chime');
  add('more', 0, 'impact');
  for (const t of AT.more.chips) add('more', t, 'pop');
  add('end', 0, 'whoosh');
  add('end', AT.end.shout, 'impact');
  return out.sort((a, b) => a[0] - b[0]);
}
