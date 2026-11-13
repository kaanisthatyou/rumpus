// The landing page's behavior: two languages, the app windows (mock.js), and what moves. No dependencies.
// With `prefers-reduced-motion` nothing below animates; every scene stands in its final state.
import { MARK, rumpusWindow, showScene } from './mock.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

// ---------------------------------------------------------------- languages

/** Turkish; English is what the page is written in and is read from it on start. */
const TR = {
  title: 'Rumpus: agentları aynı odaya topla',
  skip: 'Ne yaptığına geç',
  'nav.room': 'Ne yapar',
  'nav.no': 'Neler yok',
  'bub.label': 'Şamata çıkar',
  'hero.title': 'Agentları<br>aynı odaya<br>topla.',
  'hero.lead':
    'Rumpus, insanların ve zaten kullandıkları CLI kodlama agentlarının birlikte çalıştığı açık kaynak bir masaüstü uygulaması. Üye listesinde Claude Code ve Codex’in de olduğu bir Discord sunucusu gibi.',
  'cta.get': 'Alfayı indir',
  'cta.plan': 'Planı oku',
  'cta.source': 'Kaynağı oku',
  'hero.note': 'Windows ve Linux için 0.9 alfa. Apache-2.0. Hesap yok.',
  'room.title': 'Odanın içi',
  'room.live.h': 'Çalışmasını izle. Yönlendir. Durdur.',
  'room.live.p':
    'Her iş canlı bir kart: adımlar, token, maliyet. Canlı izlemede bütün kayıt görünür; iş sürerken gönderilen mesaj yönünü değiştirir, tek tuş durdurur.',
  'room.approval.h': 'Riskli hiçbir şey kendiliğinden çalışmaz.',
  'room.approval.p':
    'Yeni agentlar salt okunur başlar ve yalnızca sahibini dinler. Yetkisini aşan komut, bir insan izin verene kadar kartta bekler.',
  'room.race.h': 'Yarıştır.',
  'room.race.p':
    '<code>/yarış</code> aynı görevi birkaç agenta birden verir; her biri kendi git worktree’sinde çalışır. Sonuçlar yan yana durur; biri tutulur, hazırlanmış (staged) değişiklik olarak.',
  'room.board.h': 'İşi yapan bir pano.',
  'room.board.p':
    '<code>/todo</code> bir kart ekler. Karta bir agent atanınca kart işe dönüşür; iş bitince kart incelemeye geçer.',
  'room.team.h': 'Ekibi getir. Sunucuyu boş ver.',
  'room.team.p':
    'Alan, davet kodu ve rollerle paylaşılır. Her agent yine sahibinin bilgisayarında, sahibinin kendi girişi ve sınırlarıyla çalışır.',
  'no.title': 'Rumpus’ta bunlar yok.',
  'no.1.w': 'Kendi agentı',
  'no.1.s': 'Bilgisayarda zaten kurulu ve giriş yapılmış CLI’ları çalıştırır: bugün Claude Code ve Codex.',
  'no.2.w': 'Hesap, sunucu, aracı',
  'no.2.s':
    'Tek başına başka hiçbir şeye ihtiyaç duymaz. Ekip, Tailscale üzerinden bilgisayardan bilgisayara bağlanır; arada hiçbir şey durmaz.',
  'no.3.w': 'Telemetri',
  'no.3.s': 'Rumpus hiçbir şey göndermez. Alan, her üyenin kendi diskinde bir dosyadır.',
  'no.4.w': '“Claude ile giriş yap”',
  'no.4.s':
    'Bir CLI’ın giriş dosyalarını asla okumaz, kopyalamaz, taşımaz. Resmî programı başlatır; o da kendi girişini kullanır.',
  'net.title': 'Tek başına ya da ekiple.',
  'net.solo.alt': 'Rumpus ve iki CLI agentı çalıştıran tek bir bilgisayar; bulut yok.',
  'net.cloud': 'bulut yok',
  'net.pc1': 'Kaan’ın bilgisayarı',
  'net.own': 'kendi girişleri, kendi diski',
  'net.solo.h': 'Tek başına',
  'net.solo.p': 'Hesap yok, ağ yok; bilgisayardaki CLI’lar dışında kurulum yok.',
  'net.team.alt': 'Birbirine doğrudan bağlı üç bilgisayar; ortada sunucu yok.',
  'net.server': 'sunucu yok',
  'net.team.h': 'Ekiple',
  'net.team.p':
    'Her üye alanın tamamını kendi bilgisayarında tutar. İki üye çevrimiçi olduğunda imzalı olaylarla eşitlenir. Kimse sunucu değildir; kapanan bir bilgisayar yalnızca kendi agentlarını çevrimdışı yapar.',
  'more.goal': 'Agent bir plan yazar, bir insan onaylar; agent, bitiş kontrolü geçene kadar adım adım çalışır.',
  'more.spec.t': 'Uzmanlar',
  'more.spec': 'Tek tür iş için agentlar: bir çalışma kılavuzu, bir bütçe ve sakladıkları dersler.',
  'more.adv.t': 'Danışmanlar',
  'more.adv':
    'Kişinin kendi API anahtarlarıyla çalışan, projeyi okuyup dürüst yorum yapan botlar. <code>/meclis</code> onları bir masaya toplar.',
  'more.undo.t': 'Geri alma',
  'more.undo': 'Git deposunda kart, işin neyi değiştirdiğini listeler, her farkı gösterir ve geri alır.',
  'more.rout.t': 'Rutinler',
  'more.rout': 'Belirlenen saatlerde, sahibinin adına gönderilen mesaj: her sabah “@test testleri çalıştır”.',
  'more.conn.t': 'Bağlayıcılar',
  'more.conn':
    'MCP bağlayıcıları Rumpus’un kendi geçidinin arkasında çalışır; her araç için izin, sorma ya da engel ayarlanır.',
  'more.mem.t': 'Kayıtlar ve bellek',
  'more.mem': 'Fikirler, referans görseller, kayıtlı komutlar ve insanların okuyup düzenleyebildiği küçük bir bellek.',
  'more.phone.t': 'Telefon',
  'more.phone': 'Aynı alan Tailscale üzerinden telefonda; bir iş onay beklediğinde bildirim gelir.',
  'end.title': 'Şamata<br>çıkar.',
  'end.lead': 'Rumpus 0.9 alfa aşamasında ve Apache-2.0 ile açık kaynak. Şimdilik Windows ve Linux.',
  'foot.legal':
    'Rumpus’un Anthropic, OpenAI, Discord ya da Tailscale ile bir bağı yoktur. Claude Code, Codex, Discord ve Tailscale, sahiplerinin ürün adlarıdır.',
  'foot.plan': 'Plan',
};

const EN = { title: document.title };
for (const el of $$('[data-t]')) EN[el.dataset.t] = el.innerHTML.trim().replace(/\s+/g, ' ');
for (const el of $$('[data-t-label]')) EN[el.dataset.tLabel] = el.getAttribute('aria-label');

function stored() {
  try {
    return localStorage.getItem('rumpus-lang');
  } catch {
    return null;
  }
}

let lang = stored() ?? (navigator.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en');

function applyLanguage() {
  const dict = lang === 'tr' ? TR : EN;
  document.documentElement.lang = lang;
  document.title = dict.title;
  for (const el of $$('[data-t]')) el.innerHTML = dict[el.dataset.t] ?? EN[el.dataset.t];
  for (const el of $$('[data-t-label]')) el.setAttribute('aria-label', dict[el.dataset.tLabel]);
  const toggle = $('#lang');
  toggle.textContent = lang === 'tr' ? 'EN' : 'TR';
  toggle.setAttribute('aria-label', lang === 'tr' ? 'English' : 'Türkçe');
  $$('[data-split]').forEach(split);
  $$('[data-strike]').forEach(strike);
  buildWindows();
  buildTape();
  measureLetters();
}

$('#lang').addEventListener('click', () => {
  lang = lang === 'tr' ? 'en' : 'tr';
  try {
    localStorage.setItem('rumpus-lang', lang);
  } catch {
    // private mode: the choice lasts for this visit
  }
  applyLanguage();
});

// ---------------------------------------------------------------- type that stands out of line

const TILT = [-3, 2, -1.5, 3, -2, 1.5];
const LIFT = [0.012, -0.016, 0.008, -0.012, 0.016, -0.004];

/** Wraps every letter of a heading in a span; screen readers get the plain text. */
function split(el) {
  const lines = el.innerHTML.split(/<br\s*\/?>/i).map((l) => l.replace(/<[^>]+>/g, '').trim());
  el.setAttribute('aria-label', lines.join(' '));
  let i = 0;
  el.innerHTML = lines
    .map((line) =>
      line
        .split(' ')
        .map((word) => {
          const letters = [...word]
            .map((c) => {
              const k = i++;
              return `<span class="ch" style="--i:${k};--r:${TILT[k % 6]}deg;--y:${LIFT[k % 6]}em" data-r="${TILT[k % 6]}" data-y="${LIFT[k % 6]}">${c}</span>`;
            })
            .join('');
          return `<span class="word" aria-hidden="true">${letters}</span>`;
        })
        .join(' '),
    )
    .join('<br>');
}

const SCRIBBLES = [
  'M2 12C14 4 22 17 36 9S58 15 70 8 90 14 98 7',
  'M2 8C12 15 26 5 40 11S62 5 74 12 92 6 98 11',
  'M2 10C16 6 20 15 34 12S56 4 68 10 88 15 98 9',
];

/** Wraps every word of a refused thing in a span with a scribble over it; the scroll draws the scribbles. */
function strike(el) {
  const words = el.textContent.trim().split(/\s+/);
  el.setAttribute('aria-label', words.join(' '));
  el.innerHTML = words
    .map(
      (w, i) =>
        `<span class="sw" aria-hidden="true" style="--i:${i};--n:${words.length}">${w}<i><svg viewBox="0 0 100 20" preserveAspectRatio="none"><path d="${SCRIBBLES[i % 3]}"/><path d="${SCRIBBLES[i % 3]}"/></svg></i></span>`,
    )
    .join('');
}

// letters of the hero's headline give way to the pointer
const title = $('.hero__title');
let letters = [];

function measureLetters() {
  letters = $$('.ch', title).map((el) => {
    const r = el.getBoundingClientRect();
    return { el, x: r.left + r.width / 2 + scrollX, y: r.top + r.height / 2 + scrollY };
  });
}

function settle(el) {
  el.style.setProperty('--r', `${el.dataset.r}deg`);
  el.style.setProperty('--y', `${el.dataset.y}em`);
  el.style.removeProperty('--x');
}

if (!reduce && matchMedia('(hover: hover)').matches) {
  let frame = 0;
  title.addEventListener('pointermove', (e) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const reach = Math.max(120, title.offsetWidth * 0.16);
      for (const l of letters) {
        const dx = l.x - (e.clientX + scrollX);
        const dy = l.y - (e.clientY + scrollY);
        const dist = Math.hypot(dx, dy);
        if (dist > reach) {
          settle(l.el);
          continue;
        }
        const f = (1 - dist / reach) ** 2;
        l.el.style.setProperty('--x', `${(dx / (dist || 1)) * f * 34}px`);
        l.el.style.setProperty('--y', `calc(${l.el.dataset.y}em + ${(dy / (dist || 1)) * f * 34}px)`);
        l.el.style.setProperty('--r', `${Number(l.el.dataset.r) + (dx > 0 ? 1 : -1) * f * 14}deg`);
      }
    });
  });
  title.addEventListener('pointerleave', () => {
    cancelAnimationFrame(frame);
    for (const l of letters) settle(l.el);
  });
}

// ---------------------------------------------------------------- the app windows

function buildWindows() {
  for (const host of $$('[data-win]')) {
    const scenes = host.dataset.win.split(',');
    host.innerHTML = rumpusWindow({
      lang,
      scenes,
      bare: host.hasAttribute('data-bare'),
      focus: host.hasAttribute('data-focus'),
    });
  }
  roomScene = -1;
}

const play = (host, scene) => {
  const win = host.firstElementChild;
  if (!win) return;
  if (reduce) win.dataset.scene = scene;
  else showScene(win, scene);
};

// the hero's window runs its job again and again while it is on screen
const heroWin = $('#heroWin');
let heroTimer = 0;
new IntersectionObserver(([entry]) => {
  clearInterval(heroTimer);
  if (!entry.isIntersecting || reduce) return;
  play(heroWin, 'job');
  heroTimer = setInterval(() => play(heroWin, 'job'), 13000);
}).observe(heroWin);

// below the wide layout every scene has a window of its own, which runs when it comes into view
const miniSeen = new IntersectionObserver(
  (entries) => {
    for (const e of entries) if (e.isIntersecting) play(e.target, e.target.dataset.win);
  },
  { threshold: 0.5 },
);
for (const mini of $$('.room__mini')) miniSeen.observe(mini);

// ---------------------------------------------------------------- Bub

const bub = $('#bub');
const burst = $('#burst');
const ctx = burst.getContext('2d');
let bits = [];

function sizeBurst() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  burst.width = innerWidth * dpr;
  burst.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** Chevrons and cursors, the two halves of the face, thrown from where Bub stands. */
function throwBits() {
  const r = bub.getBoundingClientRect();
  const ox = r.left + r.width * 0.45;
  const oy = r.top + r.height * 0.45;
  for (let i = 0; i < 54; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 7 + Math.random() * 15;
    bits.push({
      x: ox,
      y: oy,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 6,
      rot: Math.random() * 6,
      spin: (Math.random() - 0.5) * 0.5,
      size: 10 + Math.random() * 20,
      kind: i % 2,
      color: ['#0a0b0d', '#e9ecf1', '#0a0b0d'][i % 3],
      life: 1,
    });
  }
}

function drawBits() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  for (const b of bits) {
    b.vy += 0.6;
    b.x += b.vx;
    b.y += b.vy;
    b.vx *= 0.985;
    b.rot += b.spin;
    b.life -= 0.012;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rot);
    ctx.globalAlpha = clamp(b.life * 2);
    ctx.lineWidth = b.size * 0.42;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = b.color;
    ctx.beginPath();
    if (b.kind) {
      ctx.moveTo(-b.size * 0.4, -b.size * 0.55);
      ctx.lineTo(b.size * 0.3, 0);
      ctx.lineTo(-b.size * 0.4, b.size * 0.55);
    } else {
      ctx.moveTo(0, -b.size * 0.5);
      ctx.lineTo(0, b.size * 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }
  bits = bits.filter((b) => b.life > 0 && b.y < innerHeight + 60);
}

function rumpus() {
  bub.classList.remove('is-loud');
  document.body.classList.remove('is-shaking');
  void bub.offsetWidth;
  bub.classList.add('is-loud');
  setTimeout(() => bub.classList.remove('is-loud'), 900);
  if (reduce) return;
  document.body.classList.add('is-shaking');
  setTimeout(() => document.body.classList.remove('is-shaking'), 520);
  throwBits();
  for (const l of letters) {
    l.el.style.setProperty('--x', `${(Math.random() - 0.5) * 50}px`);
    l.el.style.setProperty('--y', `${(Math.random() - 0.5) * 0.3}em`);
    l.el.style.setProperty('--r', `${(Math.random() - 0.5) * 34}deg`);
  }
  setTimeout(() => {
    for (const l of letters) settle(l.el);
  }, 420);
}

bub.addEventListener('click', rumpus);

// Bub follows the pointer from where it stands: the face looks at it and the body leans a little that way
if (!reduce) {
  addEventListener('pointermove', (e) => {
    const r = bub.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy) || 1;
    const far = Math.min(1, d / 420);
    const x = (dx / d) * far;
    const y = (dy / d) * far;
    bub.style.setProperty('--ex', `${x * 30}px`);
    bub.style.setProperty('--ey', `${y * 26}px`);
    bub.style.setProperty('--bx', `${x * 12}px`);
    bub.style.setProperty('--by', `${y * 8}px`);
    bub.style.setProperty('--br', `${x * 6}deg`);
  });
}

// ---------------------------------------------------------------- the tape

const tape = $('#tape');
// The commands under their names in each language (packages/protocol/src/commands.ts).
const TAPE = {
  tr: ['/todo', '/goal', '/yarış', '/meclis', '/özet', '/durum', '/hatırla', '@claude', '@codex'],
  en: ['/todo', '/goal', '/race', '/council', '/summary', '/status', '/remember', '@claude', '@codex'],
};
function buildTape() {
  const words = TAPE[lang];
  const run = Array.from({ length: 6 }, () => words).flat();
  tape.innerHTML = run.map((w) => `<span>${w}</span>${MARK}`).join('');
}
let tapeX = 0;

// ---------------------------------------------------------------- what the scroll drives

const room = $('#room');
const roomWin = $('#roomWin');
const roomItems = $$('#roomList li');
const noItems = $$('#noList li');
const noBub = $('.no__bub');
const wide = matchMedia('(min-width: 1040px)');
let roomScene = -1;
let lastY = scrollY;
let speed = 0;

function setRoomScene(i) {
  if (i === roomScene) return;
  roomScene = i;
  roomItems.forEach((li, k) => {
    li.classList.toggle('is-on', k === i);
  });
  play(roomWin, roomItems[i].dataset.scene);
}

roomItems.forEach((li, i) => {
  $('button', li).addEventListener('click', () => {
    if (!wide.matches) return;
    const span = room.offsetHeight - innerHeight;
    scrollTo({ top: room.offsetTop + ((i + 0.5) / roomItems.length) * span });
  });
});

function frame() {
  const vh = innerHeight;
  speed += (scrollY - lastY - speed) * 0.2;
  lastY = scrollY;

  // the hero's window rises out of perspective as it comes up the screen
  if (!reduce) {
    const top = heroWin.getBoundingClientRect().top;
    heroWin.style.setProperty('--p', clamp((vh * 0.98 - top) / (vh * 0.55)).toFixed(3));
  }

  // one scene per stretch of the pinned section
  if (wide.matches) {
    const r = room.getBoundingClientRect();
    const p = clamp(-r.top / (r.height - vh), 0, 0.999);
    setRoomScene(Math.floor(p * roomItems.length));
  }

  // each refusal is struck out as it climbs the screen
  for (const li of noItems) {
    const r = li.getBoundingClientRect();
    const p = reduce ? 1 : clamp((vh * 0.86 - r.top) / (vh * 0.3));
    li.style.setProperty('--p', p.toFixed(3));
    const struck = p >= 1;
    if (struck !== li.classList.contains('is-struck')) {
      li.classList.toggle('is-struck', struck);
      if (struck && !reduce) {
        noBub.classList.remove('is-hit');
        void noBub.offsetWidth;
        noBub.classList.add('is-hit');
      }
    }
  }

  // the tape runs on its own and faster with the scroll
  if (!reduce) {
    tapeX -= 0.7 + Math.abs(speed) * 0.5;
    const half = tape.scrollWidth / 2;
    if (-tapeX > half) tapeX += half;
    tape.style.transform = `translateX(${tapeX.toFixed(1)}px) skewX(${clamp(speed * -0.5, -14, 14).toFixed(2)}deg)`;
  }

  if (bits.length) drawBits();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- start

applyLanguage();
sizeBurst();
addEventListener('resize', () => {
  sizeBurst();
  measureLetters();
});
document.fonts.ready.then(() => {
  measureLetters();
  if (!reduce) for (const el of $$('[data-split]')) el.classList.add('is-in');
  setTimeout(measureLetters, 1400);
});
requestAnimationFrame(frame);
