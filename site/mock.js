// A drawing of the app's window in HTML, for the landing page, the posters and the reel (marketing/). It follows
// the real shell (rail, channel list, channel, crew panel) and uses the app's own labels; the conversations in it
// are examples. Styles: mock.css. Everything that moves is a CSS animation that runs under `.play`, so a page can
// restart a scene by toggling the class and the reel can seek it frame by frame.

const ICONS = {
  hash: 'M5 9h14M5 15h14M10 4 8 20M16 4l-2 16',
  term: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM7 10l3 2-3 2M12.5 15H16',
  home: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z',
  image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5',
  bookmark: 'M7 4h10v16l-5-4-5 4z',
  layers: 'M12 4l9 5-9 5-9-5zM3 14l9 5 9-5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6 6 18',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  chev: 'M9 6l6 6-6 6',
  warn: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  invite: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M18 8v6M15 11h6',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
};

export const icon = (name) =>
  `<svg class="rw-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;

/** The logo's bubble, for the title bar and the rail. */
export const MARK =
  '<svg class="rw-mark" viewBox="0 0 512 512" aria-hidden="true"><g transform="rotate(-6 256 256)"><path d="M152 88H360A96 96 0 0 1 456 184V284A96 96 0 0 1 360 380H276L170 456Q142 474 146 442L154 380H152A96 96 0 0 1 56 284V184A96 96 0 0 1 152 88Z" fill="var(--mark-body,#0a0b0d)"/><path d="M170 180l62 54-62 54" fill="none" stroke="var(--mark-face,#c6f24e)" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/><rect x="308" y="176" width="48" height="116" rx="24" fill="var(--mark-face,#c6f24e)"/></g></svg>';

/** The app's labels (from its locale files) and the example conversations. */
export const TEXT = {
  en: {
    ws: 'Team',
    storage: 'Team workspace',
    search: 'Search or command',
    overview: 'Overview',
    channels: 'Channels',
    general: 'general',
    agents: 'Agents',
    waiting: 'Waiting',
    board: 'Board',
    tasks: 'Tasks',
    goals: 'Goals',
    routines: 'Routines',
    records: 'Records',
    ideas: 'Ideas',
    references: 'References',
    commands: 'Commands',
    memory: 'Memory',
    crew: 'In the workspace',
    invite: 'Invite',
    workers: 'Workers',
    members: 'Members',
    admin: 'Admin',
    editor: 'Editor',
    thisDevice: 'this device',
    idle: 'Idle',
    running: 'Running',
    attention: 'Waiting for approval',
    done: 'Done',
    topic: 'Agents are called with @ in a message.',
    today: 'Today',
    message: 'Message',
    read: 'Read',
    edited: 'Edited',
    command: 'Command',
    searched: 'Searched',
    steerStep: 'Steer',
    steer: 'Steer',
    stop: 'Stop',
    watch: 'Watch live',
    live: 'Live view',
    modeRead: 'Read',
    modeEdit: 'Edit',
    usage: (a, b, c) => `${a} new · ${b} cached · ${c} output`,
    changes: 'Changes',
    files: (n) => (n === 1 ? '1 file' : `${n} files`),
    allow: 'Allow',
    deny: 'Deny',
    race: 'Race',
    raceCmd: '/race',
    ready: 'Ready to compare',
    keepNone: 'Keep none',
    keep: (n) => `Keep ${n}`,
    raceNote: 'The kept one is applied to the main folder as staged changes; nothing is committed.',
    owner: (n) => `Owner: ${n}`,
    steerPh: 'Steer · sent with Enter',
    todo: 'To do',
    doing: 'In progress',
    review: 'In review',
    quota: 'Claude Code quota',
    h5: '5 hours',
    week: 'Week',
    // examples
    m1a: 'The login test fails one run in five.',
    m1b: 'find out why and fix it',
    a1: 'The test read the session before the token refresh had finished. The refresh is awaited now; 14 tests pass.',
    liveL1: 'restore() calls refresh() without waiting for it',
    liveL2: '13 passed, 1 failed: session survives a restart',
    liveSteer: 'keep the public API as it is',
    liveL3: 'refresh() awaited inside restore(); no signature changed',
    liveL4: '14 passed',
    m3: 'ship it when the tests pass',
    apprWhy: 'Push the fix to the remote',
    m4: 'rewrite the date parser without the regex',
    r1: 'A small state machine, one pass, no backtracking.',
    r2: 'Split on separators, then validate each part.',
    c1: 'Rate-limit the invite endpoint',
    c2: 'Flaky login test',
    c3: 'Phone layout: dark theme',
    c4: 'Changelog for 0.9',
    c5: 'Undo for a job’s changes',
    c6: 'Date parser without the regex',
    t1: 'Pulled. The parser race is on my screen too.',
    t2: 'which endpoints have no tests?',
    a5: 'Three have none: POST /invite, GET /export and DELETE /member.',
  },
  tr: {
    ws: 'Ekip',
    storage: 'Ekip alanı',
    search: 'Ara ya da komut',
    overview: 'Genel bakış',
    channels: 'Kanallar',
    general: 'genel',
    agents: 'Agentlar',
    waiting: 'Bekleyenler',
    board: 'Pano',
    tasks: 'Görevler',
    goals: 'Hedefler',
    routines: 'Rutinler',
    records: 'Kayıtlar',
    ideas: 'Fikirler',
    references: 'Referanslar',
    commands: 'Komutlar',
    memory: 'Bellek',
    crew: 'Buradakiler',
    invite: 'Davet',
    workers: 'İşçiler',
    members: 'Üyeler',
    admin: 'Yönetici',
    editor: 'Düzenleyici',
    thisDevice: 'bu cihaz',
    idle: 'Boşta',
    running: 'Çalışıyor',
    attention: 'Onay bekliyor',
    done: 'Bitti',
    topic: 'Agentlar mesajda @ ile çağrılır.',
    today: 'Bugün',
    message: 'Mesaj',
    read: 'Okudu',
    edited: 'Düzenledi',
    command: 'Komut',
    searched: 'Aradı',
    steerStep: 'Yönlendirme',
    steer: 'Yönlendir',
    stop: 'Durdur',
    watch: 'Canlı izle',
    live: 'Canlı izleme',
    modeRead: 'Oku',
    modeEdit: 'Düzenle',
    usage: (a, b, c) => `${a} yeni · ${b} önbellek · ${c} çıktı`,
    changes: 'Değişiklikler',
    files: (n) => `${n} dosya`,
    allow: 'İzin ver',
    deny: 'Reddet',
    race: 'Yarış',
    raceCmd: '/yarış',
    ready: 'Karşılaştırmaya hazır',
    keepNone: 'Hiçbiri kalmasın',
    keep: (n) => `${n} kalsın`,
    raceNote: 'Biri tutulduğunda işi ana klasöre hazırlanmış (staged) değişiklik olarak uygulanır; commit edilmez.',
    owner: (n) => `Sahibi: ${n}`,
    steerPh: 'Yönlendirme · Enter ile gönderilir',
    todo: 'Yapılacak',
    doing: 'Sürüyor',
    review: 'İncelemede',
    quota: 'Claude Code kotası',
    h5: '5 saat',
    week: 'Hafta',
    m1a: 'Giriş testi beş çalıştırmada bir kalıyor.',
    m1b: 'nedenini bul ve düzelt',
    a1: 'Test, token yenilemesi bitmeden oturumu okuyordu. Yenileme artık bekleniyor; 14 test geçiyor.',
    liveL1: 'restore(), refresh() çağrısını beklemeden devam ediyor',
    liveL2: '13 geçti, 1 kaldı: session survives a restart',
    liveSteer: 'public API olduğu gibi kalsın',
    liveL3: 'refresh() artık restore() içinde bekleniyor; imza değişmedi',
    liveL4: '14 geçti',
    m3: 'testler geçince gönder',
    apprWhy: 'Düzeltmeyi uzak depoya gönder',
    m4: 'tarih ayrıştırıcıyı regex olmadan yeniden yaz',
    r1: 'Küçük bir durum makinesi; tek geçiş, geri dönüş yok.',
    r2: 'Ayraçlardan böl, sonra her parçayı doğrula.',
    c1: 'Davet uç noktasına hız sınırı',
    c2: 'Arada kalan giriş testi',
    c3: 'Telefon düzeni: koyu tema',
    c4: '0.9 değişiklik günlüğü',
    c5: 'Bir işin değişikliklerini geri alma',
    c6: 'Regex’siz tarih ayrıştırıcı',
    t1: 'Çektim. Ayrıştırıcı yarışı bende de görünüyor.',
    t2: 'hangi uç noktaların testi yok?',
    a5: 'Üçünün testi yok: POST /invite, GET /export ve DELETE /member.',
  },
};

const d = (s) => `style="--d:${s}s"`;
/** A card's usage line; the numbers are written with a comma and shown with the language's decimal mark. */
const usage = (t, a, b, c, cost = '') =>
  t.usage(a, b, c).replace(/,/g, t === TEXT.en ? '.' : ',') + (cost ? ` · ${cost}` : '');
const av = (letter, cls = '') => `<span class="rw-av ${cls}">${letter}</span>`;
const agentAv = (cls = '') => `<span class="rw-av rw-av--agent ${cls}">${icon('term')}</span>`;
const code = (s) => `<code>${s}</code>`;
const chip = (s, cls = '') => `<span class="rw-chip ${cls}">${s}</span>`;

function msg(who, time, lines, delay, agent = false) {
  const head = agent
    ? `<b>${who}</b>${chip(`@${who.toLowerCase()}`)}<time>${time}</time>`
    : `<b>${who}</b><time>${time}</time>`;
  return `<div class="rw-msg in" ${d(delay)}>${agent ? agentAv() : av(who[0])}<div><div class="rw-msg__h">${head}</div>${lines.map((l) => `<p>${l}</p>`).join('')}</div></div>`;
}
const at = (h) => `<span class="rw-at">@${h}</span>`;

function step(delay, verb, what, extra = '') {
  return `<li class="in" ${d(delay)}><span class="rw-tick">${icon('check')}</span><span>${verb}</span>${code(what)}${extra}</li>`;
}
const diff = (a, b) => `<span class="rw-diff"><i>+${a}</i><u>−${b}</u></span>`;

/** Running until `end` seconds, then Done with the time. */
function runState(t, end, time) {
  return `<span class="rw-state"><span class="rw-state__a swa" ${d(end)}><i class="rw-ring"></i>${t.running}</span><span class="rw-state__b swb" ${d(end)}>${t.done} · ${time}</span></span>`;
}

function card({ t, name, cli, mode, state, steps, foot, extra = '', cls = '', delay = 0, chips = '' }) {
  return `<div class="rw-card in ${cls}" ${d(delay)}><div class="rw-card__h">${agentAv()}<b>${name}</b>${chip(cli)}${chip(mode)}${chips}${state}</div><ul class="rw-steps">${steps}</ul>${extra}<div class="rw-card__f"><span>${foot}</span><span class="rw-card__btns"><span class="rw-ghost">${icon('search')}${t.watch}</span></span></div></div>`;
}

// ---------------------------------------------------------------- scenes

const SCENES = {
  /** A message to an agent, the job card filling in, the answer. About 9 s. */
  job(t) {
    return (
      msg('Kaan', '09:32', [t.m1a, `${at('claude')} ${t.m1b}`], 0.2) +
      card({
        t,
        name: 'Claude',
        cli: 'claude-code',
        mode: t.modeEdit,
        delay: 1.3,
        state: runState(t, 6.6, '0:48'),
        steps:
          step(2.0, t.read, 'auth/session.test.ts') +
          step(2.8, t.read, 'auth/session.ts') +
          step(3.7, t.command, 'pnpm test auth') +
          step(4.8, t.edited, 'auth/session.ts', diff(6, 2)) +
          step(5.8, t.command, 'pnpm test auth'),
        foot: usage(t, '2,1k', '18k', '640', '$0.031'),
        extra: `<div class="rw-changes in" ${d(6.8)}>${icon('chev')}<b>${t.changes}</b><span>${t.files(1)}</span>${diff(6, 2)}</div>`,
      }) +
      msg('Claude', '09:33', [t.a1], 7.4, true)
    );
  },

  /** The live view of a running job, steered in the middle. */
  live(t) {
    const line = (delay, cls, text) => `<div class="rw-log ${cls} in" ${d(delay)}>${text}</div>`;
    return `<div class="rw-live in" ${d(0.1)}>
      <div class="rw-live__h">${agentAv('rw-av--run')}<b>${t.live}</b><span class="rw-live__n">Claude · claude-code</span><span class="rw-card__btns"><span class="rw-btn">${icon('chev')}${t.steer}</span><span class="rw-btn">${icon('x')}${t.stop}</span></span></div>
      <div class="rw-live__b">
        ${line(0.6, 'rw-log--tool', `${t.read} ${code('auth/session.ts')}`)}
        ${line(1.3, '', t.liveL1)}
        ${line(2.1, 'rw-log--tool', `${t.command} ${code('pnpm test auth')}`)}
        ${line(2.9, 'rw-log--bad', t.liveL2)}
        ${line(4.0, 'rw-log--steer', `${t.steerStep} · Kaan: ${t.liveSteer}`)}
        ${line(5.0, 'rw-log--tool', `${t.edited} ${code('auth/session.ts')} ${diff(6, 2)}`)}
        ${line(5.7, '', t.liveL3)}
        ${line(6.5, 'rw-log--tool', `${t.command} ${code('pnpm test auth')}`)}
        ${line(7.2, 'rw-log--ok', t.liveL4)}
        <div class="rw-log rw-caret"></div>
      </div>
      <div class="rw-live__f"><span class="rw-typed" ${d(3.2)}>${t.liveSteer}</span><span class="rw-live__ph swa" ${d(3.2)}>${t.steerPh}</span><span class="rw-key">Enter</span></div>
    </div>`;
  },

  /** A command the agent may not run on its own: the job waits for a person. */
  approval(t) {
    return (
      msg('Kaan', '11:04', [`${at('claude')} ${t.m3}`], 0.2) +
      `<div class="rw-card rw-card--wait in" ${d(1.1)}><div class="rw-card__h">${agentAv()}<b>Claude</b>${chip('claude-code')}${chip(t.modeEdit)}<span class="rw-state rw-state--warn"><i class="rw-dot"></i>${t.attention} · 0:21</span></div>
      <ul class="rw-steps">${step(1.6, t.command, 'pnpm test')}<li class="in rw-steps__wait" ${d(2.3)}><i class="rw-ring rw-ring--warn"></i><span>${t.command}</span>${code('git push origin main')}</li></ul>
      <div class="rw-appr in" ${d(2.9)}><div><b>${t.attention}</b><p><span>${t.command}</span>${code('git push origin main')}</p><small>${t.apprWhy}</small></div><span class="rw-card__btns"><span class="rw-btn">${icon('x')}${t.deny}</span><span class="rw-btn rw-btn--go">${icon('check')}${t.allow}</span></span></div>
      <div class="rw-card__f"><span>${usage(t, '1,4k', '22k', '310')}</span><span class="rw-card__btns"><span class="rw-ghost">${icon('search')}${t.watch}</span><span class="rw-btn">${icon('chev')}${t.steer}</span><span class="rw-btn">${icon('x')}${t.stop}</span></span></div></div>`
    );
  },

  /** One task, two agents, each in a worktree of its own; one result is kept. */
  race(t) {
    const lane = (name, cli, place, time, files, a, b, answer, delay) =>
      `<div class="rw-lane"><div class="rw-lane__h">${agentAv()}<b>${name}</b><span class="rw-place swb" ${d(delay)}>${place}.</span></div><div class="rw-lane__c">${chip(cli)}${chip(t.modeEdit)}</div>
      <div class="rw-lane__s"><span class="swa" ${d(delay)}><i class="rw-ring"></i>${t.running}</span><span class="swb rw-ok" ${d(delay)}>${t.done} ${time}</span></div>
      <div class="rw-bar"><i ${d(delay)}></i></div>
      <div class="rw-lane__m in" ${d(delay + 0.2)}>${t.files(files)} ${diff(a, b)}</div><div class="rw-lane__a in" ${d(delay + 0.4)}>${answer}</div>
      <div class="rw-lane__f in" ${d(5.4)}><span class="rw-ghost">${icon('search')}${t.watch}</span><span class="rw-btn rw-btn--go">${icon('check')}${t.keep(name)}</span></div></div>`;
    return (
      msg('Kaan', '13:20', [`<span class="rw-cmd">${t.raceCmd}</span> ${t.m4}`], 0.2) +
      `<div class="rw-card rw-race in" ${d(1.1)}><div class="rw-card__h">${icon('bolt')}<b>${t.race}</b><span class="rw-race__s swb" ${d(5.2)}>${t.ready}</span><span class="rw-ghost rw-race__x">${t.keepNone}</span></div>
      <div class="rw-lanes">${lane('Claude', 'claude-code', 1, '1:12', 3, 42, 31, t.r1, 3.6)}${lane('Codex', 'codex', 2, '1:40', 2, 28, 19, t.r2, 4.9)}</div>
      <div class="rw-race__n">${t.raceNote}</div></div>`
    );
  },

  /** The board: a card with an agent becomes a job, and moves on when the job ends. */
  board(t) {
    const c = (text, who, cls = '', extra = '') =>
      `<div class="rw-kard ${cls}" ${extra}><p>${text}</p>${who ? `<span>${agentAv()}@${who}</span>` : ''}</div>`;
    const col = (name, n, cards) => `<div class="rw-col"><h5>${name}<i>${n}</i></h5>${cards}</div>`;
    return `<div class="rw-board in" ${d(0.1)}>
      ${col(t.todo, 2, c(t.c1, 'codex') + c(t.c3, ''))}
      ${col(t.doing, 1, c(t.c2, 'claude', 'rw-kard--run rw-kard--leave', d(3.4)))}
      ${col(t.review, 2, c(t.c6, 'claude') + c(t.c2, 'claude', 'rw-kard--arrive', d(3.4)))}
      ${col(t.done, 2, c(t.c5, 'claude') + c(t.c4, ''))}
    </div>`;
  },

  /** A team: another member gives a task to an agent that runs on its owner's computer. */
  team(t) {
    return (
      msg('Arda', '14:05', [t.t1, `${at('claude')} ${t.t2}`], 0.2) +
      card({
        t,
        name: 'Claude',
        cli: 'claude-code',
        mode: t.modeRead,
        chips: chip(t.owner('Kaan'), 'rw-chip--owner'),
        delay: 1.3,
        state: runState(t, 4.4, '0:19'),
        steps:
          step(2.0, t.searched, 'router.(get|post|delete)') +
          step(2.9, t.read, 'test/api') +
          step(3.7, t.read, 'src/routes'),
        foot: usage(t, '1,8k', '12k', '280', '$0.012'),
      }) +
      msg('Claude', '14:05', [t.a5], 5.0, true)
    );
  },
};

export const SCENE_NAMES = Object.keys(SCENES);

/** Which sidebar row is the open page in a scene, and whether something waits. */
const SIDE = { job: 'general', live: 'general', approval: 'general', race: 'general', board: 'tasks', team: 'general' };

function sidebar(t, scene) {
  const row = (key, ic, label, extra = '') =>
    `<div class="rw-row" data-row="${key}"${SIDE[scene] === key ? ' data-on' : ''}>${icon(ic)}<span>${label}</span>${extra}</div>`;
  return `<aside class="rw__side">
    <div class="rw-ws"><b>${t.ws}</b><small><i class="rw-on"></i>${t.storage} · Tailscale</small></div>
    <div class="rw-search">${icon('search')}<span>${t.search}</span><kbd>Ctrl K</kbd></div>
    ${row('overview', 'home', t.overview)}
    <h6>${t.channels}</h6>${row('general', 'hash', t.general)}
    <h6>${t.agents}</h6>${row('claude', 'term', '@claude')}${row('codex', 'term', '@codex')}
    <div class="rw-row rw-row--wait" data-row="waiting">${icon('warn')}<span>${t.waiting}</span><em>1</em></div>
    <h6>${t.board}</h6>${row('tasks', 'list', t.tasks)}${row('goals', 'target', t.goals)}${row('routines', 'clock', t.routines)}
    <h6>${t.records}</h6>${row('ideas', 'bulb', t.ideas)}${row('references', 'image', t.references)}${row('commands', 'bookmark', t.commands)}${row('memory', 'layers', t.memory)}
    <div class="rw-me">${av('K')}<div><b>Kaan</b><small>${t.admin}</small></div></div>
  </aside>`;
}

function crew(t) {
  const worker = (name, cli, owner) =>
    `<div class="rw-who" data-agent="${name.toLowerCase()}">${agentAv()}<div><b>${name} <small>@${name.toLowerCase()}</small></b><small>${cli} · <span class="rw-who__idle">${owner ? t.owner(owner) : t.idle}</span><span class="rw-who__run">${t.running}</span><span class="rw-who__wait">${t.attention}</span></small></div></div>`;
  return `<aside class="rw__crew">
    <div class="rw-crew__h"><b>${t.crew}</b><span class="rw-btn">${icon('invite')}${t.invite}</span></div>
    <h6>${t.workers}</h6>${worker('Claude', 'Claude Code')}${worker('Codex', 'Codex')}
    <h6>${t.members}<i>2</i></h6>
    <div class="rw-who">${av('K', 'rw-av--on')}<div><b>Kaan <small>· ${t.thisDevice}</small></b><small>${t.admin}</small></div></div>
    <div class="rw-who">${av('A', 'rw-av--on')}<div><b>Arda</b><small>${t.editor}</small></div></div>
    <div class="rw-quota"><b>${t.quota}</b><p><span>${t.h5}</span><i style="--v:37%"></i><span>%37</span></p><p><span>${t.week}</span><i style="--v:18%"></i><span>%18</span></p></div>
  </aside>`;
}

/**
 * The window. `scenes` are stacked in the middle column and the one named by the window's `data-scene` shows;
 * `play` adds the class that runs the first scene's animations.
 */
export function rumpusWindow({ lang = 'en', scenes = ['job'], play = false, bare = false, focus = false } = {}) {
  const t = TEXT[lang];
  const first = scenes[0];
  const stage = scenes
    .map((s) => `<div class="rw-scene${play && s === first ? ' play' : ''}" data-scene="${s}">${SCENES[s](t)}</div>`)
    .join('');
  return `<div class="rw${bare ? ' rw--bare' : ''}${focus ? ' rw--focus' : ''}" data-scene="${first}" aria-hidden="true"><div class="rw__in">
    <div class="rw__bar">${MARK}<span>Rumpus</span><i></i><i></i><i></i></div>
    <div class="rw__body">
      <nav class="rw__rail"><span class="rw-rail__logo">${MARK}</span><span class="rw-rail__ws">Ek</span><span class="rw-rail__add">${icon('plus')}</span></nav>
      ${sidebar(t, first)}
      <main class="rw__main">
        <header class="rw__head">${icon('hash')}<b>${t.general}</b><span>${t.topic}</span></header>
        <header class="rw__head rw__head--board">${icon('list')}<b>${t.tasks}</b></header>
        <div class="rw__stage"><div class="rw-day"><span>${t.today}</span></div>${stage}</div>
        <footer class="rw__composer">${icon('plus')}<span>${t.message} · #${t.general}</span><kbd>Enter</kbd><b>${icon('arrow')}</b></footer>
      </main>
      ${crew(t)}
    </div>
  </div></div>`;
}

/** Shows another scene of a window made by `rumpusWindow` and runs its animations from the start. */
export function showScene(win, scene) {
  win.dataset.scene = scene;
  for (const row of win.querySelectorAll('.rw-row[data-row]')) {
    if (row.dataset.row !== 'waiting') row.toggleAttribute('data-on', row.dataset.row === SIDE[scene]);
  }
  for (const el of win.querySelectorAll('.rw-scene')) {
    el.classList.remove('play');
    if (el.dataset.scene === scene) {
      void el.offsetWidth;
      el.classList.add('play');
    }
  }
}
