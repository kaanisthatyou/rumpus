// The reel as one page: seven scenes on one clock, every movement a CSS animation whose delay is its time on that
// clock. Opened in a browser it plays (reel.html?lang=tr|en; a click starts it again with the soundtrack);
// render.mjs opens it with ?render, stops every animation and sets the clock frame by frame (`window.seek`).
import { MARK, rumpusWindow } from '../../site/mock.js';
import { AT, DURATION, HEIGHT, K, K_TEAM, SCENES, SHAKES, WIDTH } from './timeline.js';

const q = new URLSearchParams(location.search);
const lang = q.get('lang') === 'en' ? 'en' : 'tr';
const rendering = q.has('render');
document.documentElement.lang = lang;

const TEXT = {
  tr: {
    hookA: ['Discord’u', 'duymuşsunuzdur.'],
    hookB: ['Peki ya size', 'yapay zekâ', 'ajanlarınızı', 'kullanabileceğiniz', 'bir hâli var desem?'],
    members: 'Üyeler',
    rows: [
      ['K', 'Kaan', 'Yönetici'],
      ['A', 'Arda', 'Düzenleyici'],
      ['>', 'Claude', 'Claude Code · Çalışıyor'],
      ['>', 'Codex', 'Codex · Boşta'],
    ],
    tagline: 'Agentları aynı odaya topla.',
    demo: 'Mesajı yaz. İşini izle.',
    done: 'bitti.',
    race: ['Aynı işi ikisine ver.', 'Biri kalsın.'],
    team: 'Arkadaşının agentına iş ver.',
    teamNote: 'Kaan’ın bilgisayarında, Kaan’ın sınırlarıyla çalışır.',
    hand: 'Agentlar birbirine görev verir.',
    nodes: [
      ['Claude', 'isteği parçalara böldü', 'yanıtları topladı'],
      ['Codex', 'kod · çalışıyor', 'kod · bitti'],
      ['3D modelci', 'Blender · çalışıyor', 'Blender · bitti'],
    ],
    handNote: 'Bir parça yalnızca bir kez paslanır.',
    more: ['Dahası', 'da var.'],
    feats: ['Pano', 'Hedefler', 'Uzmanlar', 'Danışmanlar', 'Rutinler', 'Bellek', 'Bağlayıcılar', 'Telefon', 'Geri al'],
    end: 'Senin agentların. Senin bilgisayarın.',
    chips: ['Açık kaynak', 'Apache-2.0', 'Windows', 'Linux', '0.9 alfa'],
  },
  en: {
    hookA: ['You’ve heard', 'of Discord.'],
    hookB: ['What if I told you', 'your AI', 'agents', 'could be members', 'of one like it?'],
    members: 'Members',
    rows: [
      ['K', 'Kaan', 'Admin'],
      ['A', 'Arda', 'Editor'],
      ['>', 'Claude', 'Claude Code · Running'],
      ['>', 'Codex', 'Codex · Idle'],
    ],
    tagline: 'Put your agents in one room.',
    demo: 'Ask. Watch it work.',
    done: 'done.',
    race: ['Give two the same task.', 'Keep one.'],
    team: 'Task a friend’s agent.',
    teamNote: 'It runs on Kaan’s computer, under Kaan’s limits.',
    hand: 'Agents give each other tasks.',
    nodes: [
      ['Claude', 'split the request', 'collected the answers'],
      ['Codex', 'code · running', 'code · done'],
      ['3D modeler', 'Blender · running', 'Blender · done'],
    ],
    handNote: 'A part is handed on only once.',
    more: ['And there’s', 'more.'],
    feats: ['Board', 'Goals', 'Specialists', 'Advisors', 'Routines', 'Memory', 'Connectors', 'Phone', 'Undo'],
    end: 'Your agents. Your computer.',
    chips: ['Open source', 'Apache-2.0', 'Windows', 'Linux', '0.9 alpha'],
  },
};
const t = TEXT[lang];

// ---------------------------------------------------------------- pieces

const TILT = [-3, 2, -1.5, 3, -2, 1.5];
const LIFT = [0.012, -0.016, 0.008, -0.012, 0.016, -0.004];
/** The wordmark's own tilts, so the animated word lands as the logo. */
const WORDMARK = [
  [-5, 0.033],
  [4, -0.043],
  [-2, 0.022],
  [5, -0.033],
  [-4, 0.043],
  [3, -0.011],
];

/** A line of display type whose letters land one after another. */
function line(text, { top, d, max = 200, cls = '', center = false }) {
  const letters = [...text]
    .map((c, i) =>
      c === ' ' ? ' ' : `<span class="ch" style="--i:${i};--r:${TILT[i % 6]}deg;--y:${LIFT[i % 6]}em">${c}</span>`,
    )
    .join('');
  return `<h2 class="line ${cls}${center ? ' line--center' : ''}" data-max="${max}" style="top:${top}px;--d:${d}s">${letters}</h2>`;
}

function wordmark(top, d, size) {
  const letters = [...'rumpus']
    .map((c, i) => `<span class="ch" style="--i:${i};--r:${WORDMARK[i][0]}deg;--y:${WORDMARK[i][1]}em">${c}</span>`)
    .join('');
  return `<h2 class="line line--center wordmark" style="top:${top}px;--d:${d}s;font-size:${size}px">${letters}</h2>`;
}

const BODY =
  'M152 88H360A96 96 0 0 1 456 184V284A96 96 0 0 1 360 380H276L170 456Q142 474 146 442L154 380H152A96 96 0 0 1 56 284V184A96 96 0 0 1 152 88Z';

/** Bub. `shout` is when (seconds into the scene) the mouth opens and the noise marks fly, if at all. */
function bub({ left, top, width, d, shout, cls = '' }) {
  const s = shout === undefined ? '' : `--shout:${shout}s`;
  return `<div class="bub ${cls}${shout === undefined ? '' : ' bub--shouts'}" style="left:${left}px;top:${top}px;width:${width}px;--d:${d}s;${s}">
    <svg viewBox="-60 -70 640 620"><g transform="rotate(-6 256 256)">
      <path class="bub__noise" d="M468 76l30-44M500 150l52-18M410 52l6-56"/>
      <path class="bub__shape" d="${BODY}"/>
      <path class="bub__chev" d="M170 180l62 54-62 54"/>
      <rect class="bub__cur" x="308" y="176" width="48" height="116" rx="24"/>
      <path class="bub__smile" d="M238 318q28 26 56 0"/>
      <path class="bub__mouth" d="M222 312h88a44 44 0 0 1-88 0z"/>
    </g></svg></div>`;
}

/** A small seeded generator, so every render throws the same bits. */
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Chevrons and cursors thrown from a point. */
function burst({ x, y, d, n = 44, seed = 7, colors = ['#0a0b0d', '#e9ecf1'] }) {
  const r = rng(seed);
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const v = 260 + r() * 620;
    const size = 26 + r() * 46;
    out += `<i class="bit${i % 2 ? ' bit--chev' : ''}" style="left:${x}px;top:${y}px;--d:${d}s;--dx:${Math.round(Math.cos(a) * v)}px;--dy:${Math.round(Math.sin(a) * v * 0.7 + 520)}px;--up:${Math.round(-180 - r() * 420)}px;--rot:${Math.round((r() - 0.5) * 900)}deg;--s:${size.toFixed(0)}px;--c:${colors[i % colors.length]}"><b></b></i>`;
  }
  return out;
}

const win = (scene, { left, top, width, d, max, k = K }) =>
  `<div class="win" style="left:${left}px;top:${top}px;width:${width}px;--d:${d}s;--rw-max:${max}px"><div class="win__cam"><div style="--t0:calc(var(--t0s) + ${d}s);--k:${k}">${rumpusWindow({ lang, scenes: [scene], play: true, bare: true })}</div></div></div>`;

// The commands as the app has them: only some have an English name, and the English reel shows only those.
const TAPE =
  lang === 'tr'
    ? ['/todo', '/goal', '/yarış', '/meclis', '/özet', '/durum', '@claude', '@codex']
    : ['/todo', '/goal', '/race', '@claude', '@codex', 'Ctrl K'];
const tape = (top, rot, dir) =>
  `<div class="tape" style="top:${top}px;--rot:${rot}deg;--dir:${dir}"><div>${[...TAPE, ...TAPE, ...TAPE, ...TAPE].map((w) => `<span>${w}</span>${MARK}`).join('')}</div></div>`;

// ---------------------------------------------------------------- scenes

/** A scene: shown from its start until its end plus `hold` (while the next one comes in over it). */
function scene(name, inner, { hold = 0, cls = '' } = {}) {
  const [a, b] = SCENES[name];
  return `<section class="sc sc--${name} ${cls}" style="--t0:${a}s;--t0s:${a}s;--t1:${b + hold}s;--len:${b - a}s"><div class="sc__in">${inner}</div></section>`;
}

const hookA = scene(
  'hookA',
  line(t.hookA[0], { top: 600, d: AT.hookA.words[0], max: 210 }) +
    line(t.hookA[1], { top: 830, d: AT.hookA.words[1], max: 210 }) +
    `<div class="typing" style="top:1090px;--d:${AT.hookA.typing}s"><i></i><i></i><i></i></div>`,
);

const hookB = scene(
  'hookB',
  line(t.hookB[0], { top: 250, d: AT.hookB.words[0], max: 104, cls: 'mute' }) +
    line(t.hookB[1], { top: 380, d: AT.hookB.words[1], max: 190, cls: 'lime' }) +
    line(t.hookB[2], { top: 570, d: AT.hookB.words[2], max: 190, cls: 'lime' }) +
    line(t.hookB[3], { top: 780, d: AT.hookB.words[3], max: 124 }) +
    line(t.hookB[4], { top: 910, d: AT.hookB.words[4], max: 124 }) +
    `<div class="crew" style="--d:1.25s"><h3>${t.members}<span>4</span></h3>${t.rows
      .map(
        ([a, name, role], i) =>
          `<div class="crew__row${a === '>' ? ' crew__row--agent' : ''}${i === 2 ? ' crew__row--run' : ''}" style="--d:${AT.hookB.rows[i]}s"><b>${a === '>' ? MARK : a}</b><p>${name}<small>${role}</small></p></div>`,
      )
      .join('')}</div>`,
  { hold: 0.5 },
);

const reveal = scene(
  'reveal',
  bub({ left: 250, top: 420, width: 620, d: AT.reveal.bub, cls: 'bub--ink' }) +
    wordmark(1010, AT.reveal.word, 262) +
    `<p class="tagline rise" style="top:1360px;--d:${AT.reveal.line}s">${t.tagline}</p>` +
    burst({ x: 540, y: 720, d: 0.3 }),
  { hold: 0.45, cls: 'sc--lime sc--circle' },
);

const demo = scene(
  'demo',
  `<div class="cap" style="top:230px;--d:0.15s">${t.demo}</div>` +
    win('job', { left: 50, top: 500, width: 980, d: AT.demo.win, max: 24 }) +
    `<div class="sticker pop" style="right:70px;top:1560px;--d:${AT.demo.win + AT.demo.done + 0.1}s">${t.done}</div>`,
  { hold: 0.3, cls: 'sc--rise' },
);

const race = scene(
  'race',
  `<div class="cap cap--until" style="top:230px;--d:0.1s;--until:2.1s">${t.race[0]}</div>` +
    `<div class="cap cap--lime" style="top:230px;--d:2.1s">${t.race[1]}</div>` +
    win('race', { left: 50, top: 500, width: 980, d: AT.race.win, max: 24 }),
  { cls: 'sc--whip' },
);

// another member gives a task to an agent that runs on its owner's computer
const team = scene(
  'team',
  `<div class="cap" style="top:230px;--d:0.1s">${t.team}</div>` +
    win('team', { left: 50, top: 500, width: 980, d: AT.team.win, max: 24, k: K_TEAM }) +
    `<div class="note" style="top:1650px;--d:${AT.team.note}s">${t.teamNote}</div>`,
  { hold: 0.35, cls: 'sc--whip' },
);

// an agent hands parts of a request to other agents and collects their answers
const node = (i, [name, before, after], style) =>
  `<div class="node${i ? '' : ' node--first'}" style="${style};--d:${AT.handover.nodes[i]}s;--sw:${i ? AT.handover.done[i - 1] : AT.handover.back + 0.45}s"><b>${MARK}</b><p>${name}<small><span>${before}</span><span>${after}</span></small></p></div>`;
const pulse = (x0, y0, x1, y1, d) =>
  `<i class="pulse" style="--x0:${x0}px;--y0:${y0}px;--x1:${x1}px;--y1:${y1}px;--d:${d}s"></i>`;
const handover = scene(
  'handover',
  `<div class="cap cap--lime" style="top:230px;--d:0.1s">${t.hand}</div>` +
    `<svg class="wires" viewBox="0 0 1080 1920" style="--d:${AT.handover.nodes[1] - 0.15}s"><path pathLength="1" d="M540 800C540 960 290 940 290 1100"/><path pathLength="1" d="M540 800C540 960 790 940 790 1100"/></svg>` +
    node(0, t.nodes[0], 'left:190px;top:590px;width:700px') +
    node(1, t.nodes[1], 'left:40px;top:1100px;width:490px') +
    node(2, t.nodes[2], 'left:550px;top:1100px;width:490px') +
    pulse(540, 800, 290, 1100, AT.handover.send) +
    pulse(540, 800, 790, 1100, AT.handover.send + 0.08) +
    pulse(290, 1100, 540, 800, AT.handover.back) +
    pulse(790, 1100, 540, 800, AT.handover.back + 0.08) +
    `<div class="note" style="top:1480px;--d:${AT.handover.note}s">${t.handNote}</div>`,
  { hold: 0.4, cls: 'sc--rise' },
);

// the rest of what is in the app, one name after another
const FEAT_TILT = [-3, 2, -1.5, 2.5, -2, 3, -2.5, 1.5, -3];
const more = scene(
  'more',
  line(t.more[0], { top: 150, d: AT.more.title, max: 190 }) +
    line(t.more[1], { top: 340, d: AT.more.title + 0.12, max: 190 }) +
    `<div class="feats">${t.feats.map((f, i) => `<span class="${i % 3 === 1 ? 'feat feat--paper' : 'feat'}" style="--r:${FEAT_TILT[i]}deg;--d:${AT.more.chips[i]}s">${f}</span>`).join('')}</div>` +
    `<img class="waver" src="../../brand/bub/bub-wave-on-lime.svg" alt="" style="--d:0.3s;--bob:${AT.more.chips[0]}s">`,
  { hold: 0.4, cls: 'sc--lime sc--drop' },
);

const end = scene(
  'end',
  tape(170, -4, 1) +
    bub({ left: 260, top: 400, width: 600, d: AT.end.bub, shout: AT.end.shout, cls: 'bub--lime' }) +
    wordmark(990, AT.end.word, 250) +
    `<p class="tagline tagline--lime rise" style="top:1300px;--d:${AT.end.line}s">${t.end}</p>` +
    `<div class="chips" style="top:1420px">${t.chips.map((c, i) => `<span class="pop" style="--d:${AT.end.line + 0.25 + i * 0.09}s">${c}</span>`).join('')}</div>` +
    tape(1640, 3, -1) +
    burst({ x: 540, y: 700, d: AT.end.shout, seed: 11, colors: ['#c6f24e', '#e9ecf1'] }),
  { cls: 'sc--wipe' },
);

const stage = document.getElementById('stage');
const shakes = SHAKES.map((s) => `shake 0.45s linear ${s}s`).join(', ');
stage.innerHTML = `<div id="cam" style="animation:${shakes}">${hookA}${hookB}${reveal}${demo}${race}${team}${handover}${more}${end}</div>`;

// ---------------------------------------------------------------- fit, clock

/** Sets a line's size so it fills the width it has, up to its `data-max`. */
function fitLines() {
  for (const el of stage.querySelectorAll('.line[data-max]')) {
    const max = Number(el.dataset.max);
    el.style.fontSize = `${max}px`;
    const room = WIDTH - 140;
    if (el.scrollWidth > room) el.style.fontSize = `${Math.floor((max * room) / el.scrollWidth)}px`;
  }
}

function scale() {
  const s = rendering ? 1 : Math.min(innerWidth / WIDTH, innerHeight / HEIGHT);
  stage.style.transform = `scale(${s})`;
}

await document.fonts.ready;
await Promise.all([...document.fonts].map((f) => f.load().catch(() => {})));
fitLines();
scale();
addEventListener('resize', scale);

const all = document.getAnimations();

/** Sets the reel's clock (milliseconds). Used by render.mjs; every animation is stopped at that time. */
window.seek = (ms) => {
  for (const a of all) {
    a.pause();
    a.currentTime = ms;
  }
};
window.DURATION = DURATION;

if (rendering) {
  document.body.classList.add('rendering');
  window.seek(0);
} else {
  const audio = new Audio(`../out/reel-audio.wav`);
  const hint = document.getElementById('hint');
  hint.textContent = lang === 'tr' ? 'Sesle baştan oynatmak için tıkla' : 'Click to play again with sound';
  addEventListener('click', () => {
    for (const a of all) {
      a.currentTime = 0;
      a.play();
    }
    audio.currentTime = 0;
    audio.play().catch(() => {});
  });
}
document.documentElement.dataset.ready = '1';
