// The posters, as data and markup. Each is a function of the language that returns its size and its inner HTML.
import { MARK, rumpusWindow } from '../site/mock.js';

const B = '../brand';
const TILT = [-3, 2, -1.5, 3, -2, 1.5];
const LIFT = [0.012, -0.016, 0.008, -0.012, 0.016, -0.004];

/** A headline whose letters stand a little out of line, as on the site. Lines are separated by `|`. */
function jostle(text) {
  let i = 0;
  return text
    .split('|')
    .map((line) =>
      line
        .split(' ')
        .map(
          (word) =>
            `<span class="word">${[...word].map((c) => `<span class="ch" style="--r:${TILT[i % 6]}deg;--y:${LIFT[i++ % 6]}em">${c}</span>`).join('')}</span>`,
        )
        .join(' '),
    )
    .join('<br>');
}

const SCRIBBLES = [
  'M2 12C14 4 22 17 36 9S58 15 70 8 90 14 98 7',
  'M2 8C12 15 26 5 40 11S62 5 74 12 92 6 98 11',
  'M2 10C16 6 20 15 34 12S56 4 68 10 88 15 98 9',
];
const struck = (line) =>
  `<div>${line
    .split(' ')
    .map(
      (w, i) =>
        `<span class="sw">${w}<svg viewBox="0 0 100 20" preserveAspectRatio="none"><path d="${SCRIBBLES[i % 3]}"/></svg></span>`,
    )
    .join('')}</div>`;

const win = (lang, scene, style, opts = {}) =>
  `<div class="win" style="${style}">${rumpusWindow({ lang, scenes: [scene], ...opts })}</div>`;
const img = (src, style) => `<img src="${B}/${src}" alt="" style="${style}">`;
// The commands under their names in each language (packages/protocol/src/commands.ts).
const COMMANDS = {
  tr: ['/todo', '/goal', '/yarış', '/meclis', '/özet', '/durum', '/hatırla', '@claude', '@codex'],
  en: ['/todo', '/goal', '/race', '/council', '/summary', '/status', '/remember', '@claude', '@codex'],
};
const tape = (lang, style) => {
  const words = [...COMMANDS[lang], ...COMMANDS[lang]];
  return `<div class="tape" style="${style}">${[...words, ...words].map((w) => `<span>${w}</span>${MARK}`).join('')}</div>`;
};

const T = {
  en: {
    head: 'Put your|agents in|one room.',
    sub: 'An open-source desktop hub for people and the CLI coding agents they already use.',
    spec: 'Windows and Linux. Apache-2.0.',
    alpha: '0.9<br>alpha',
    no: 'Rumpus|says no.',
    refusals: [
      'An agent of its own',
      'Accounts, servers',
      'Telemetry',
      '“Sign in with Claude”',
      'Agents that start themselves',
    ],
    yours: 'Your agents. Your logins. Your computer.',
    race: 'Race|them.',
    raceSub:
      '<span class="mono lime">/race</span> gives one task to several agents at once, each in a git worktree of its own. One result is kept.',
    hook1: 'You’ve heard|of Discord.',
    hook2: 'Now picture your AI agents in the member list.',
    hookSub: 'Rumpus drives the Claude Code and Codex already on the computer. No account, no server.',
    steer: 'Watch it.|Steer it.|Stop it.',
    steerSub: 'Every job is a live card. A message sent mid-run changes its course.',
    banner: 'Put your agents in one room.',
  },
  tr: {
    head: 'Agentları|aynı odaya|topla.',
    sub: 'İnsanlar ve zaten kullandıkları CLI kodlama agentları için açık kaynak bir masaüstü uygulaması.',
    spec: 'Windows ve Linux. Apache-2.0.',
    alpha: '0.9<br>alfa',
    no: 'Rumpus’ta|bunlar yok.',
    refusals: [
      'Kendi agentı',
      'Hesap, sunucu',
      'Telemetri',
      '“Claude ile giriş yap”',
      'Kendi kendine başlayan agentlar',
    ],
    yours: 'Agentlar senin. Girişler senin. Bilgisayar senin.',
    race: 'Yarıştır.',
    raceSub:
      '<span class="mono lime">/yarış</span> aynı görevi birkaç agenta birden verir; her biri kendi git worktree’sinde çalışır. Biri kalır.',
    hook1: 'Discord’u|duymuşsunuzdur.',
    hook2: 'Peki ya üye listesinde yapay zekâ ajanlarınız olsaydı?',
    hookSub: 'Rumpus, bilgisayarda zaten kurulu Claude Code ve Codex’i çalıştırır. Hesap yok, sunucu yok.',
    steer: 'İzle.|Yönlendir.|Durdur.',
    steerSub: 'Her iş canlı bir kart. İş sürerken gönderilen mesaj yönünü değiştirir.',
    banner: 'Agentları aynı odaya topla.',
  },
};

export const POSTERS = {
  // Instagram / LinkedIn post, 4:5
  launch: (lang, t = T[lang]) => ({
    w: 1080,
    h: 1350,
    html: `
      ${img('logo/lockup-on-lime.svg', 'left:56px;top:44px;height:96px')}
      <h1 style="left:60px;top:176px;font-size:${lang === 'tr' ? 150 : 164}px">${jostle(t.head)}</h1>
      ${img('bub/bub-wink-on-lime.svg', `right:-6px;top:${lang === 'tr' ? 14 : 120}px;width:${lang === 'tr' ? 280 : 380}px;transform:rotate(8deg)`)}
      <p style="left:64px;top:${lang === 'tr' ? 640 : 690}px;width:600px;font-size:33px">${t.sub}</p>
      ${win(lang, 'job', 'left:64px;top:880px;width:1240px;transform:rotate(-3deg);--rw-max:22px', { focus: true })}
      <div class="sticker" style="right:56px;top:790px;width:190px;height:190px;font-size:44px">${t.alpha}</div>`,
  }),

  // the refusals
  no: (lang, t = T[lang]) => ({
    w: 1080,
    h: 1350,
    html: `
      <h1 style="left:60px;top:64px;font-size:${lang === 'tr' ? 132 : 150}px">${jostle(t.no)}</h1>
      ${img('bub/bub-placard-on-lime.svg', 'right:26px;top:36px;width:330px')}
      <div class="strikes" style="left:60px;top:412px;width:960px;font-size:${lang === 'tr' ? 68 : 72}px">${t.refusals.map(struck).join('')}</div>
      <p style="left:60px;bottom:150px;width:960px;font-size:36px">${t.yours}</p>
      ${img('logo/lockup-on-lime.svg', 'left:52px;bottom:40px;height:86px')}`,
  }),

  // races, on the dark ground
  race: (lang, t = T[lang]) => ({
    w: 1080,
    h: 1350,
    dark: true,
    html: `
      ${img('logo/lockup-on-dark.svg', 'left:52px;top:44px;height:92px')}
      ${img('bub/bub-shout.svg', 'right:36px;top:40px;width:300px')}
      <h1 style="left:60px;top:186px;font-size:${lang === 'tr' ? 176 : 170}px">${jostle(t.race)}</h1>
      <p style="left:64px;top:${lang === 'tr' ? 400 : 530}px;width:820px;font-size:34px;color:var(--mute)">${t.raceSub}</p>
      ${win(lang, 'race', `left:60px;top:${lang === 'tr' ? 590 : 700}px;width:1060px;transform:rotate(2deg);--rw-max:23px`, { bare: true })}`,
  }),

  // the hook of the reel as a still
  discord: (lang, t = T[lang]) => ({
    w: 1080,
    h: 1350,
    dark: true,
    html: `
      ${img('logo/lockup-on-dark.svg', 'left:52px;top:44px;height:92px')}
      <h1 style="left:60px;top:190px;font-size:${lang === 'tr' ? 112 : 132}px">${jostle(t.hook1)}</h1>
      <h1 class="lime" style="left:60px;top:${lang === 'tr' ? 420 : 460}px;width:900px;font-size:${lang === 'tr' ? 74 : 80}px;line-height:.98">${t.hook2}</h1>
      <p style="left:62px;top:${lang === 'tr' ? 610 : 660}px;width:760px;font-size:30px;color:var(--mute)">${t.hookSub}</p>
      ${win(lang, 'team', 'left:-420px;top:830px;width:1460px;transform:rotate(-2deg);--rw-max:26px', { focus: true })}`,
  }),

  // live view and steering
  steer: (lang, t = T[lang]) => ({
    w: 1080,
    h: 1350,
    html: `
      ${img('logo/lockup-on-lime.svg', 'left:56px;top:44px;height:96px')}
      <h1 style="left:60px;top:176px;font-size:${lang === 'tr' ? 138 : 146}px">${jostle(t.steer)}</h1>
      ${img('bub/bub-wave-on-lime.svg', 'right:10px;top:150px;width:340px')}
      <p style="left:64px;top:600px;width:720px;font-size:34px">${t.steerSub}</p>
      ${win(lang, 'live', 'left:60px;top:740px;width:1010px;transform:rotate(-2deg);--rw-max:23px', { bare: true })}`,
  }),

  // story / reel cover, 9:16
  story: (lang, t = T[lang]) => ({
    w: 1080,
    h: 1920,
    html: `
      ${img('logo/lockup-on-lime.svg', 'left:56px;top:150px;height:104px')}
      ${img('bub/bub-wink-on-lime.svg', `right:10px;top:${lang === 'tr' ? 110 : 250}px;width:${lang === 'tr' ? 320 : 400}px;transform:rotate(8deg)`)}
      <h1 style="left:60px;top:420px;font-size:${lang === 'tr' ? 162 : 176}px">${jostle(t.head)}</h1>
      <p style="left:64px;top:${lang === 'tr' ? 920 : 980}px;width:780px;font-size:38px">${t.sub}</p>
      ${win(lang, 'job', 'left:60px;top:1200px;width:1000px;transform:rotate(-3deg);--rw-max:22px', { bare: true })}
      ${tape(lang, 'left:-40px;right:-40px;top:1130px;transform:rotate(-3deg)')}`,
  }),

  // link preview (Open Graph, X card)
  og: (lang, t = T[lang]) => ({
    w: 1200,
    h: 630,
    html: `
      ${img('logo/lockup-on-lime.svg', 'left:52px;top:40px;height:84px')}
      <h1 style="left:56px;top:170px;font-size:${lang === 'tr' ? 118 : 128}px">${jostle(t.head)}</h1>
      ${img('bub/bub-wink-on-lime.svg', 'right:40px;top:120px;width:400px;transform:rotate(6deg)')}
      <p class="mono" style="right:56px;bottom:44px;font-size:24px">${t.spec}</p>`,
  }),

  // GitHub's social preview, 2:1
  github: (lang, t = T[lang]) => ({
    w: 1280,
    h: 640,
    dark: true,
    html: `
      ${img('logo/lockup-on-dark.svg', 'left:56px;top:44px;height:92px')}
      <h1 style="left:60px;top:190px;width:760px;font-size:${lang === 'tr' ? 96 : 104}px">${jostle(t.head)}</h1>
      ${win(lang, 'job', 'left:700px;top:150px;width:900px;transform:rotate(-3deg);--rw-max:17px', { bare: true })}
      <p style="left:62px;bottom:48px;width:560px;font-size:25px;color:var(--mute)">${t.sub}</p>`,
  }),

  // profile banner (X), 3:1
  banner: (lang, t = T[lang]) => ({
    w: 1500,
    h: 500,
    html: `
      ${img('logo/lockup-on-lime.svg', 'left:60px;top:110px;height:170px')}
      <p style="left:76px;top:300px;font-size:44px;font-weight:600">${t.banner}</p>
      ${img('bub/bub-shout-on-lime.svg', 'right:90px;top:40px;width:360px')}
      ${tape(lang, 'left:-40px;right:-40px;bottom:-14px;transform:rotate(-1.5deg)')}`,
  }),
};

const q = new URLSearchParams(location.search);
const only = q.get('id');
const langs = q.get('lang') ? [q.get('lang')] : ['en', 'tr'];
if (only) document.body.classList.add('single');
for (const [id, make] of Object.entries(POSTERS)) {
  if (only && only !== id) continue;
  for (const lang of langs) {
    const p = make(lang);
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div class="p${p.dark ? ' p--dark' : ''}" lang="${lang}" data-id="${id}-${lang}" style="width:${p.w}px;height:${p.h}px">${p.html}</div>`,
    );
  }
}
document.documentElement.dataset.ready = '1';
