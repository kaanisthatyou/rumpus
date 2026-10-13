/* Lonca client: one page for the desktop and the phone. It talks to the hub with GET/POST /api/… and
   listens to /events (server-sent events). Everything shown comes from the hub; nothing is stored here
   but the language choice. */
(() => {
  'use strict';

  // ---------------------------------------------------------------- strings
  const STR = {
    en: {
      loading: 'Connecting…', signedOut: 'You are not in this server yet', signedOutHint: 'Ask a member for an invite link, or scan the QR on a device that is already in.',
      joinTitle: 'Join {server}', invitedBy: '{name} invited you', yourName: 'Your name', join: 'Join', inviteDead: 'This invite was already used or has expired. Ask for a new one.',
      joinAgents: 'To bring your own agents, run this on your computer instead:', pairing: 'Signing this device in…', pairDead: 'This code was already used or has expired. Make a new one (they last 10 minutes).',
      channels: 'Channels', newChannel: 'New channel', channelName: 'Channel name', people: 'People', agents: 'Agents', noAgents: 'No agents yet. They appear when a member\'s computer connects.',
      placeholder: 'Message #{ch} — call an agent with @name', send: 'Send', older: 'Older messages', empty: 'No messages here yet.',
      invite: 'Invite', phone: 'Phone', computer: 'Add a computer', close: 'Close', copy: 'Copy', copied: 'Copied', copyFail: 'Could not copy',
      inviteTitle: 'Invite someone', inviteHint: 'Works once, for 24 hours. They open the link or scan the code.', inviteCli: 'With their own agents, on their computer:',
      phoneTitle: 'Your phone', phoneHint: 'Scan with the phone\'s camera. Works once, for 10 minutes. Then add the page to the home screen.',
      viaTailscale: 'This address is on Tailscale: the other device needs the Tailscale app, signed in to the same network.', viaLan: 'This address works only on the same Wi-Fi or network.',
      localOnly: 'Only this computer can reach the server right now. Turn on Tailscale on the host computer and other devices can connect.',
      computerTitle: 'Add a computer', computerHint: 'Run this on the other computer. It signs in as you and offers the agents you set up there. Works once, for 10 minutes.',
      devices: 'Signed-in devices', thisDevice: 'this device', remove: 'Remove', removeAsk: 'Sign this device out?', signOut: 'Sign out', node: 'computer', browser: 'browser',
      owner: 'owner', offline: 'offline', busy: 'working', online: 'online', onlyOwner: 'only {name} can call it', everyone: 'anyone can call it', you: 'you',
      mode_read: 'read-only', mode_edit: 'can edit files', mode_full: 'full access', mode_custom: 'custom program',
      st_queued: 'waiting', st_running: 'working', st_done: 'done', st_failed: 'failed', st_stopped: 'stopped', st_lost: 'no record',
      stop: 'Stop', steps: '{n} steps', askedBy: 'for {name}', tokens: '{in} in · {out} out', reconnecting: 'Connection lost, reconnecting…',
      sys_joined: '{name} joined the server', sys_agent_offline: '@{agent} is offline: its computer is not connected', sys_agent_private: 'Only {owner} can call @{agent}',
      err_timeout: 'It took too long and was stopped.', err_node_offline: 'Its computer went offline.', err_node_restarted: 'Its computer restarted.', err_agent_removed: 'The agent was removed.', err_agent_queue_full: 'The agent has too many requests waiting.',
      e_name_taken: 'That name is taken in this server.', e_name_needed: 'Write a name.', e_channel_exists: 'That channel exists already.', e_too_long: 'That message is too long.', e_signed_out: 'This device was signed out.', e_not_allowed: 'You cannot do that.', e_generic: 'Something went wrong: {code}',
    },
    tr: {
      loading: 'Bağlanıyor…', signedOut: 'Henüz bu sunucuda değilsin', signedOutHint: 'Bir üyeden davet bağlantısı iste ya da zaten içeride olan bir cihazdaki QR kodu okut.',
      joinTitle: '{server} sunucusuna katıl', invitedBy: '{name} seni davet etti', yourName: 'Adın', join: 'Katıl', inviteDead: 'Bu davet kullanılmış ya da süresi dolmuş. Yenisini iste.',
      joinAgents: 'Kendi ajanlarınla katılmak için bunu bilgisayarında çalıştır:', pairing: 'Bu cihaz bağlanıyor…', pairDead: 'Bu kod kullanılmış ya da süresi dolmuş. Yenisini oluştur (10 dakika geçerli).',
      channels: 'Kanallar', newChannel: 'Yeni kanal', channelName: 'Kanal adı', people: 'Kişiler', agents: 'Ajanlar', noAgents: 'Henüz ajan yok. Bir üyenin bilgisayarı bağlanınca burada görünür.',
      placeholder: '#{ch} kanalına yaz — ajan çağırmak için @ad', send: 'Gönder', older: 'Daha eski mesajlar', empty: 'Burada henüz mesaj yok.',
      invite: 'Davet et', phone: 'Telefon', computer: 'Bilgisayar ekle', close: 'Kapat', copy: 'Kopyala', copied: 'Kopyalandı', copyFail: 'Kopyalanamadı',
      inviteTitle: 'Birini davet et', inviteHint: 'Bir kez, 24 saat geçerli. Bağlantıyı açar ya da kodu okutur.', inviteCli: 'Kendi ajanlarıyla, kendi bilgisayarında:',
      phoneTitle: 'Telefonun', phoneHint: 'Telefonun kamerasıyla okut. Bir kez, 10 dakika geçerli. Sonra sayfayı ana ekrana ekle.',
      viaTailscale: 'Bu adres Tailscale üzerinde: diğer cihazda Tailscale uygulaması kurulu ve aynı ağa giriş yapılmış olmalı.', viaLan: 'Bu adres yalnızca aynı Wi-Fi ya da ağda çalışır.',
      localOnly: 'Sunucuya şu an yalnızca bu bilgisayar ulaşabiliyor. Sunucunun çalıştığı bilgisayarda Tailscale açılınca diğer cihazlar bağlanabilir.',
      computerTitle: 'Bilgisayar ekle', computerHint: 'Bunu diğer bilgisayarda çalıştır. Senin adına bağlanır ve orada kurduğun ajanları sunar. Bir kez, 10 dakika geçerli.',
      devices: 'Bağlı cihazlar', thisDevice: 'bu cihaz', remove: 'Çıkar', removeAsk: 'Bu cihazın oturumu kapatılsın mı?', signOut: 'Çıkış yap', node: 'bilgisayar', browser: 'tarayıcı',
      owner: 'kurucu', offline: 'çevrimdışı', busy: 'çalışıyor', online: 'çevrimiçi', onlyOwner: 'yalnızca {name} çağırabilir', everyone: 'herkes çağırabilir', you: 'sen',
      mode_read: 'yalnızca okur', mode_edit: 'dosya düzenleyebilir', mode_full: 'tam yetki', mode_custom: 'özel program',
      st_queued: 'sırada', st_running: 'çalışıyor', st_done: 'bitti', st_failed: 'başarısız', st_stopped: 'durduruldu', st_lost: 'kayıt yok',
      stop: 'Durdur', steps: '{n} adım', askedBy: '{name} için', tokens: '{in} giren · {out} çıkan', reconnecting: 'Bağlantı koptu, yeniden bağlanıyor…',
      sys_joined: '{name} sunucuya katıldı', sys_agent_offline: '@{agent} çevrimdışı: bilgisayarı bağlı değil', sys_agent_private: '@{agent} ajanını yalnızca {owner} çağırabilir',
      err_timeout: 'Çok uzun sürdü, durduruldu.', err_node_offline: 'Bilgisayarı çevrimdışı oldu.', err_node_restarted: 'Bilgisayarı yeniden başladı.', err_agent_removed: 'Ajan kaldırılmış.', err_agent_queue_full: 'Ajanın bekleyen çok fazla isteği var.',
      e_name_taken: 'Bu ad bu sunucuda alınmış.', e_name_needed: 'Bir ad yaz.', e_channel_exists: 'Bu kanal zaten var.', e_too_long: 'Mesaj çok uzun.', e_signed_out: 'Bu cihazın oturumu kapatıldı.', e_not_allowed: 'Bunu yapamazsın.', e_generic: 'Bir şey ters gitti: {code}',
    },
  };
  const LANG = (localStorage.getItem('lonca_lang') || navigator.language || 'en').toLowerCase().startsWith('tr') ? 'tr' : 'en';
  document.documentElement.lang = LANG;
  const t = (key, vars) => String(STR[LANG][key] ?? STR.en[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? vars[k] : m));
  const errText = (e) => (e && STR.en['e_' + e.code] ? t('e_' + e.code) : t('e_generic', { code: (e && (e.code || e.message)) || '?' }));

  // ---------------------------------------------------------------- helpers
  const $ = (sel, root = document) => root.querySelector(sel);
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
    return el;
  }
  const icon = (name) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ic');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name);
    svg.append(use);
    return svg;
  };
  // an icon-only button names itself with `tip`
  const btn = (label, cls, onclick, ic, tip) => h('button', { class: 'btn ' + (cls || ''), type: 'button', onclick, title: tip || null, 'aria-label': tip || null }, ic ? icon(ic) : null, label ? h('span', {}, label) : null);
  function toast(text, kind) {
    const el = h('div', { class: 'toast ' + (kind || '') }, text);
    $('#toasts').append(el);
    setTimeout(() => el.remove(), 4200);
  }
  async function api(path, body) {
    const opts = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lonca': '1' }, body: JSON.stringify(body) };
    const r = await fetch(path, opts);
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) throw Object.assign(new Error(d.error || String(r.status)), { code: d.error, status: r.status });
    return d;
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast(t('copied'), 'ok'); } catch (e) { toast(t('copyFail'), 'err'); }
  }
  const clock = (ts) => new Date(ts * 1000).toLocaleTimeString(LANG, { hour: '2-digit', minute: '2-digit' });
  const day = (ts) => new Date(ts * 1000).toLocaleDateString(LANG, { day: 'numeric', month: 'long' });
  const dur = (s) => (s < 60 ? `${Math.max(0, Math.round(s))}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`);
  const kfmt = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n || 0));
  function deviceName() {
    const ua = navigator.userAgent;
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Device';
    const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
    return br ? `${os} · ${br}` : os;
  }

  // ---------------------------------------------------------------- state
  const S = { me: null, server: null, members: [], agents: [], channels: [], ch: 'general', msgs: {}, more: {}, jobs: {}, unread: {}, reachable: true, source: null, live: false };
  const app = $('#app');
  const member = (id) => S.members.find((m) => m.id === id);
  const agent = (handle) => S.agents.find((a) => a.handle === handle);
  const canCall = (a) => a.access === 'everyone' || a.owner === S.me.id;

  // ---------------------------------------------------------------- entry screens
  function card(...kids) { app.replaceChildren(h('div', { class: 'gate' }, h('div', { class: 'gate-card' }, h('img', { class: 'gate-logo', src: '/icon.svg', alt: '' }), ...kids))); }

  async function boot() {
    const [, kind, code] = location.pathname.match(/^\/([jp])\/([\w-]+)/) || [];
    card(h('p', { class: 'dim' }, t('loading')));
    let state = null;
    try { state = await api('/api/state'); } catch (e) { if (e.status !== 401) { card(h('p', { class: 'warn' }, errText(e))); return; } }
    if (state) { history.replaceState(null, '', '/'); start(state); return; }  // already in: the code stays unused
    if (kind === 'p') return pairScreen(code);
    if (kind === 'j') return joinScreen(code);
    card(h('h1', {}, t('signedOut')), h('p', { class: 'dim' }, t('signedOutHint')));
  }

  async function pairScreen(code) {
    card(h('p', { class: 'dim' }, t('pairing')));
    try {
      await api('/api/redeem', { code, device: deviceName() });
      history.replaceState(null, '', '/');
      start(await api('/api/state'));
    } catch (e) { card(h('h1', {}, 'Lonca'), h('p', { class: 'warn' }, e.code === 'pair_invalid' ? t('pairDead') : errText(e))); }
  }

  async function joinScreen(code) {
    let info;
    try { info = await api('/api/info?code=' + encodeURIComponent(code)); } catch (e) { card(h('p', { class: 'warn' }, errText(e))); return; }
    if (!info.invite) { card(h('h1', {}, info.server || 'Lonca'), h('p', { class: 'warn' }, t('inviteDead'))); return; }
    const name = h('input', { class: 'field', placeholder: t('yourName'), maxlength: 32, autocomplete: 'nickname' });
    const note = h('p', { class: 'warn' });
    const cli = `python -m lonca join ${location.origin}/j/${code}`;
    const go = async () => {
      note.textContent = '';
      try {
        await api('/api/join', { code, name: name.value, device: deviceName() });
        history.replaceState(null, '', '/');
        start(await api('/api/state'));
      } catch (e) { note.textContent = e.code === 'invite_invalid' ? t('inviteDead') : errText(e); }
    };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    card(h('h1', {}, t('joinTitle', { server: info.server })), h('p', { class: 'dim' }, t('invitedBy', { name: info.by })),
      name, btn(t('join'), 'primary wide', go), note,
      h('div', { class: 'gate-cli' }, h('p', { class: 'dim' }, t('joinAgents')), codeLine(cli)));
    name.focus();
  }
  const codeLine = (text) => h('div', { class: 'code-line' }, h('code', {}, text), btn('', 'icon', () => copy(text), 'copy', t('copy')));

  // ---------------------------------------------------------------- main screen
  function start(state) {
    apply(state);
    document.title = S.server.name;
    if (!S.channels.some((c) => c.id === S.ch)) S.ch = S.channels[0].id;
    app.replaceChildren(
      h('aside', { class: 'rail', id: 'rail' },
        h('div', { class: 'rail-head' }, h('img', { src: '/icon.svg', alt: '' }), h('b', { id: 'server-name' }, S.server.name)),
        h('div', { class: 'rail-label' }, h('span', {}, t('channels')), btn('', 'icon', newChannel, 'plus', t('newChannel'))),
        h('nav', { id: 'channels' }),
        h('div', { class: 'rail-foot' }, h('span', { class: 'dot on' }), h('b', { id: 'me-name' }, S.me.name),
          btn('', 'icon', deviceDialog, 'phone', t('phone')))),
      h('main', { class: 'chat' },
        h('header', { class: 'bar' },
          btn('', 'icon m-only', () => drawer('rail'), 'menu', t('channels')),
          h('div', { class: 'bar-title' }, icon('hash'), h('b', { id: 'ch-name' })),
          h('div', { class: 'bar-actions' },
            btn(t('invite'), 'ghost', inviteDialog, 'invite'), btn(t('phone'), 'ghost d-only', deviceDialog, 'phone'),
            btn('', 'icon narrow-only', () => drawer('side'), 'users', t('people')))),
        h('div', { class: 'notice', id: 'notice', hidden: true }),
        h('div', { class: 'feed', id: 'feed' }),
        composer()),
      h('aside', { class: 'side', id: 'side' }, h('div', { id: 'roster' })),
      h('div', { class: 'scrim', id: 'scrim', onclick: () => drawer(null) }));
    renderChannels(); renderRoster(); openChannel(S.ch);
    listen();
    setInterval(tick, 1000);
  }

  function apply(state) {
    for (const k of ['me', 'server', 'members', 'agents', 'channels', 'reachable']) if (state[k] !== undefined) S[k] = state[k];
    for (const j of state.jobs || []) S.jobs[j.id] = j;
  }

  function drawer(which) {
    for (const id of ['rail', 'side']) $('#' + id).classList.toggle('open', id === which);
    $('#scrim').classList.toggle('open', !!which);
  }

  function listen() {
    const src = new EventSource('/events');
    S.source = src;
    src.addEventListener('hello', async () => {
      $('#notice').hidden = true;
      if (S.live) {  // back after a gap: catch up on what was missed
        try { apply(await api('/api/state')); S.msgs = {}; renderChannels(); renderRoster(); openChannel(S.ch); } catch (e) { /* the next reconnect tries again */ }
      }
      S.live = true;
    });
    src.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch (e) { console.error(e); } };
    src.onerror = async () => {
      const n = $('#notice'); n.textContent = t('reconnecting'); n.hidden = false;
      try { await api('/api/state'); } catch (e) { if (e.status === 401) { src.close(); location.reload(); } }
    };
  }

  function handle(ev) {
    if (ev.kind === 'msg') {
      const m = ev.msg;
      if (S.msgs[m.ch]) S.msgs[m.ch].push(m);
      if (m.ch === S.ch) appendMessage(m, true);
      else if (m.from.kind !== 'system') { S.unread[m.ch] = (S.unread[m.ch] || 0) + 1; renderChannels(); }
    } else if (ev.kind === 'job') {
      const old = S.jobs[ev.job.id];
      S.jobs[ev.job.id] = ev.partial && old ? Object.assign(old, ev.job) : ev.job;
      refreshJob(ev.job.id);
    } else if (ev.kind === 'step') {
      const job = S.jobs[ev.id];
      if (job) { job.steps.push(ev.step); refreshJob(ev.id); }
    } else if (ev.kind === 'roster') { S.members = ev.members; S.agents = ev.agents; renderRoster(); }
    else if (ev.kind === 'channels') { S.channels = ev.channels; renderChannels(); }
  }

  // ---------------------------------------------------------------- channels and roster
  function renderChannels() {
    $('#channels').replaceChildren(...S.channels.map((c) => h('button', { class: 'chan' + (c.id === S.ch ? ' on' : ''), type: 'button', onclick: () => { openChannel(c.id); drawer(null); } },
      icon('hash'), h('span', {}, c.name), S.unread[c.id] ? h('i', { class: 'badge' }, String(S.unread[c.id])) : null)));
  }

  async function newChannel() {
    const name = prompt(t('channelName'));
    if (!name) return;
    try { const r = await api('/api/channel', { name }); openChannel(r.channel.id); } catch (e) { toast(errText(e), 'err'); }
  }

  function renderRoster() {
    const people = [...S.members].sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
    const agents = [...S.agents].sort((a, b) => (b.online - a.online) || a.handle.localeCompare(b.handle));
    $('#roster').replaceChildren(...[
      h('div', { class: 'rail-label' }, h('span', {}, `${t('people')} · ${people.length}`)),
      ...people.map((m) => h('div', { class: 'who' + (m.online ? '' : ' off') },
        h('span', { class: 'avatar', style: `--c:${m.color}` }, m.name.slice(0, 1).toUpperCase()),
        h('div', { class: 'who-text' }, h('b', {}, m.name, m.id === S.me.id ? h('small', {}, ` (${t('you')})`) : null),
          h('small', {}, [m.role === 'owner' ? t('owner') : null, m.online ? t('online') : t('offline')].filter(Boolean).join(' · '))))),
      h('div', { class: 'rail-label' }, h('span', {}, `${t('agents')} · ${agents.length}`), btn('', 'icon', computerDialog, 'pc', t('computer'))),
      agents.length ? null : h('p', { class: 'dim pad' }, t('noAgents')),
      ...agents.map((a) => {
        const owner = member(a.owner) || { name: '?', color: '#888' };
        const usable = a.online && canCall(a);
        return h('button', { class: 'who agent' + (a.online ? '' : ' off'), type: 'button', disabled: !usable, onclick: () => { mention(a.handle); drawer(null); },
          title: a.description || null },
          h('span', { class: 'avatar bot' + (a.busy ? ' busy' : ''), style: `--c:${owner.color}` }, icon('bot')),
          h('div', { class: 'who-text' }, h('b', {}, '@' + a.handle, canCall(a) ? null : icon('lock')),
            h('small', {}, [owner.name, t('mode_' + a.mode), a.busy ? t('busy') : a.online ? null : t('offline')].filter(Boolean).join(' · ')),
            h('small', {}, a.access === 'everyone' ? t('everyone') : t('onlyOwner', { name: owner.name }))));
      })].filter(Boolean));
    const me = member(S.me.id);
    if (me) $('#me-name').textContent = me.name;
  }

  // ---------------------------------------------------------------- messages
  async function openChannel(id) {
    S.ch = id;
    delete S.unread[id];
    renderChannels();
    const channel = S.channels.find((c) => c.id === id);
    $('#ch-name').textContent = channel ? channel.name : id;
    $('#input').placeholder = t('placeholder', { ch: channel ? channel.name : id });
    if (!S.msgs[id]) {
      try {
        const r = await api('/api/messages?ch=' + encodeURIComponent(id));
        S.msgs[id] = r.messages; S.more[id] = r.messages.length >= 80;
        Object.assign(S.jobs, r.jobs);
      } catch (e) { toast(errText(e), 'err'); return; }
    }
    if (S.ch !== id) return;  // switched away while loading
    const feed = $('#feed');
    feed.replaceChildren();
    if (S.more[id]) feed.append(h('button', { class: 'btn ghost older', type: 'button', onclick: older }, t('older')));
    if (!S.msgs[id].length) feed.append(h('p', { class: 'dim empty' }, t('empty')));
    for (const m of S.msgs[id]) appendMessage(m, false);
    feed.scrollTop = feed.scrollHeight;
  }

  async function older() {
    const id = S.ch, first = S.msgs[id][0];
    if (!first) return;
    try {
      const r = await api(`/api/messages?ch=${encodeURIComponent(id)}&before=${first.id}`);
      Object.assign(S.jobs, r.jobs);
      S.msgs[id] = r.messages.concat(S.msgs[id]); S.more[id] = r.messages.length >= 80;
      const feed = $('#feed'), from = feed.scrollHeight;
      await openChannel(id);
      feed.scrollTop = feed.scrollHeight - from;
    } catch (e) { toast(errText(e), 'err'); }
  }

  function appendMessage(m, live) {
    const feed = $('#feed');
    const stick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
    const empty = $('.empty', feed);
    if (empty) empty.remove();
    const last = feed.lastElementChild;
    const d = day(m.ts);
    if (feed.dataset.day !== d || !last || last.classList.contains('older')) { feed.dataset.day = d; feed.append(h('div', { class: 'day' }, h('span', {}, d))); }
    let el;
    if (m.from.kind === 'system') el = h('div', { class: 'sys' }, t('sys_' + (m.sys || {}).code, m.sys));
    else if (m.job) el = jobCard(m);
    else {
      const who = member(m.from.id) || { name: m.from.name, color: '#888' };
      const body = h('div', { class: 'md', html: MD.render(m.text) });
      marks(body);
      el = h('div', { class: 'msg' + (m.from.id === S.me.id ? ' mine' : '') },
        h('span', { class: 'avatar', style: `--c:${who.color}` }, who.name.slice(0, 1).toUpperCase()),
        h('div', { class: 'msg-body' }, h('div', { class: 'msg-head' }, h('b', { style: `color:${who.color}` }, who.name), h('time', {}, clock(m.ts))), body));
    }
    feed.append(el);
    if (!live || stick || m.from.id === S.me.id) feed.scrollTop = feed.scrollHeight;
  }

  // @handles of known agents become chips; links open in a new tab
  function marks(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('code, pre, a')) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const parts = node.textContent.split(/(@[A-Za-z0-9][\w-]{1,31})/g);
      if (parts.length < 2) continue;
      node.replaceWith(...parts.map((p) => (p.startsWith('@') && agent(p.slice(1).toLowerCase()) ? h('span', { class: 'at' }, p) : p)));
    }
    for (const a of root.querySelectorAll('a[data-href]')) {
      const href = a.getAttribute('data-href');
      if (/^https?:\/\//i.test(href)) { a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    }
  }

  // ---------------------------------------------------------------- job cards
  function jobCard(m) {
    const el = h('div', { class: 'job', id: 'job-' + m.job });
    el.dataset.handle = m.from.name;
    fillJob(el, S.jobs[m.job]);
    return el;
  }

  function refreshJob(id) {
    const el = document.getElementById('job-' + id);
    if (!el) return;
    const feed = $('#feed');
    const stick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
    fillJob(el, S.jobs[id]);
    if (stick) feed.scrollTop = feed.scrollHeight;
  }

  function fillJob(el, job) {
    const handle = el.dataset.handle;
    const owner = member((agent(handle) || job || {}).owner) || { color: '#888' };
    const status = job ? job.status : 'lost';
    const active = status === 'queued' || status === 'running';
    const open = el.dataset.open === '1';
    el.dataset.status = status;
    const steps = job ? job.steps : [];
    const shown = active ? steps.slice(-4) : open ? steps : [];
    const canStop = job && active && [job.by.id, job.owner, S.server.owner].includes(S.me.id);
    const u = (job && job.usage) || {};
    const error = job && job.error ? (STR.en['err_' + job.error] ? t('err_' + job.error) : job.error) : '';
    el.replaceChildren(
      h('span', { class: 'avatar bot' + (status === 'running' ? ' busy' : ''), style: `--c:${owner.color}` }, icon('bot')),
      h('div', { class: 'msg-body' },
        h('div', { class: 'msg-head' }, h('b', { style: `color:${owner.color}` }, '@' + handle),
          h('span', { class: 'status s-' + status }, t('st_' + status)),
          job ? h('time', { class: 'elapsed', 'data-from': job.started || job.created, 'data-to': job.ended || '' }, '') : null,
          job && job.by.id !== S.me.id ? h('small', {}, t('askedBy', { name: job.by.name })) : null,
          canStop ? btn(t('stop'), 'ghost sm', async () => { try { await api('/api/stop', { id: job.id }); } catch (e) { toast(errText(e), 'err'); } }, 'stop') : null),
        shown.length ? h('ol', { class: 'steps' }, shown.map((s) => h('li', { class: 'step ' + s.kind },
          s.kind === 'tool' ? [h('b', {}, s.label), s.arg ? h('span', {}, ' ' + s.arg) : null] : h('span', {}, s.text.split('\n')[0].slice(0, 160)))) ) : null,
        job && job.text && !active ? (() => { const b = h('div', { class: 'md', html: MD.render(job.text) }); marks(b); return b; })() : null,
        error ? h('p', { class: 'warn' }, error) : null,
        job && !active && (steps.length || u.out) ? h('div', { class: 'job-foot' },
          steps.length ? h('button', { class: 'link', type: 'button', onclick: () => { el.dataset.open = open ? '' : '1'; fillJob(el, S.jobs[job.id]); } }, t('steps', { n: steps.length })) : null,
          u.out ? h('span', {}, t('tokens', { in: kfmt((u.in || 0) + (u.cached || 0)), out: kfmt(u.out) })) : null) : null));
    tick();
  }

  function tick() {
    for (const el of document.querySelectorAll('.elapsed')) {
      const from = Number(el.dataset.from), to = Number(el.dataset.to) || Date.now() / 1000;
      el.textContent = from ? dur(to - from) : '';
    }
  }

  // ---------------------------------------------------------------- composer
  function composer() {
    const input = h('textarea', { id: 'input', rows: 1, maxlength: 20000 });
    const pop = h('div', { class: 'at-pop', hidden: true });
    let picks = [], pick = 0;
    const touch = matchMedia('(pointer: coarse)').matches;
    const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px'; };
    const token = () => (input.value.slice(0, input.selectionStart).match(/(?:^|\s)@([\w-]*)$/) || [])[1];
    const choose = (a) => {
      const head = input.value.slice(0, input.selectionStart).replace(/@[\w-]*$/, '@' + a.handle + ' ');
      input.value = head + input.value.slice(input.selectionStart);
      input.selectionStart = input.selectionEnd = head.length;
      pop.hidden = true; input.focus(); grow();
    };
    const suggest = () => {
      const q = token();
      picks = q === undefined ? [] : S.agents.filter((a) => a.handle.startsWith(q.toLowerCase())).sort((a, b) => (canCall(b) && b.online) - (canCall(a) && a.online)).slice(0, 6);
      pick = 0;
      pop.hidden = !picks.length;
      pop.replaceChildren(...picks.map((a, i) => h('button', { class: 'at-row' + (i === pick ? ' on' : ''), type: 'button', onmousedown: (e) => { e.preventDefault(); choose(a); } },
        icon('bot'), h('b', {}, '@' + a.handle), h('small', {}, [(member(a.owner) || {}).name, a.online ? (canCall(a) ? null : t('onlyOwner', { name: (member(a.owner) || {}).name })) : t('offline')].filter(Boolean).join(' · ')))));
    };
    const send = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = ''; grow(); pop.hidden = true;
      try { await api('/api/send', { ch: S.ch, text }); } catch (e) { input.value = text; grow(); toast(errText(e), 'err'); }
    };
    input.addEventListener('input', () => { grow(); suggest(); });
    input.addEventListener('blur', () => { pop.hidden = true; });
    input.addEventListener('keydown', (e) => {
      if (!pop.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault(); pick = (pick + (e.key === 'ArrowDown' ? 1 : picks.length - 1)) % picks.length;
        [...pop.children].forEach((c, i) => c.classList.toggle('on', i === pick));
      } else if (!pop.hidden && (e.key === 'Tab' || e.key === 'Enter')) { e.preventDefault(); choose(picks[pick]); }
      else if (e.key === 'Escape') pop.hidden = true;
      else if (e.key === 'Enter' && !e.shiftKey && !touch && !e.isComposing) { e.preventDefault(); send(); }
    });
    return h('div', { class: 'composer' }, pop, input, btn('', 'primary icon send', send, 'send', t('send')));
  }

  function mention(handle) {
    const input = $('#input');
    input.value = (input.value && !/\s$/.test(input.value) ? input.value + ' ' : input.value) + '@' + handle + ' ';
    input.focus();
  }

  // ---------------------------------------------------------------- dialogs
  function dialog(title, ...kids) {
    const close = () => box.remove();
    const box = h('div', { class: 'modal', onclick: (e) => { if (e.target === box) close(); } },
      h('div', { class: 'modal-card' }, h('div', { class: 'modal-head' }, h('b', {}, title), btn('', 'icon', close, 'x', t('close'))), ...kids));
    document.body.append(box);
    return box;
  }

  // one QR at a time (a camera facing two picks either); the address is switchable when the hub has several
  function linkBlock(links, hint) {
    const usable = links.filter((l) => !l.local);
    const list = usable.length ? usable : links;
    const wrap = h('div', { class: 'qr-block' });
    const show = (i) => {
      const l = list[i];
      wrap.replaceChildren(
        l.qr ? h('img', { class: 'qr', src: l.qr, alt: 'QR' }) : '',
        h('div', { class: 'qr-text' }, h('p', {}, hint),
          list.length > 1 ? h('div', { class: 'seg' }, list.map((x, n) => h('button', { class: n === i ? 'on' : '', type: 'button', onclick: () => show(n) }, x.label))) : null,
          h('p', { class: 'dim' }, l.local ? t('localOnly') : l.label === 'Tailscale' ? t('viaTailscale') : l.label === 'LAN' ? t('viaLan') : ''),
          codeLine(l.url)));
      wrap.dataset.url = l.url;
    };
    show(0);
    return wrap;
  }

  async function inviteDialog() {
    try {
      const r = await api('/api/invite', {});
      const block = linkBlock(r.links, t('inviteHint'));
      const cli = h('div', {});
      const sync = () => cli.replaceChildren(h('p', { class: 'dim' }, t('inviteCli')), codeLine('python -m lonca join ' + block.dataset.url));
      block.addEventListener('click', () => setTimeout(sync));
      sync();
      dialog(t('inviteTitle'), block, cli);
    } catch (e) { toast(errText(e), 'err'); }
  }

  async function deviceDialog() {
    try {
      const [pair, list] = await Promise.all([api('/api/pair', { kind: 'browser' }), api('/api/devices')]);
      const rows = h('div', { class: 'devices' });
      const draw = (devices) => rows.replaceChildren(h('div', { class: 'rail-label' }, h('span', {}, t('devices'))),
        ...devices.sort((a, b) => b.seen - a.seen).map((d) => h('div', { class: 'device' },
          icon(d.kind === 'node' ? 'pc' : /iPhone|iPad|Android/.test(d.name) ? 'phone' : 'window'),
          h('div', { class: 'who-text' }, h('b', {}, d.name || t(d.kind)), h('small', {}, [t(d.kind), d.current ? t('thisDevice') : null, d.online ? t('online') : day(d.seen)].filter(Boolean).join(' · '))),
          btn(d.current ? t('signOut') : t('remove'), 'ghost sm', async () => {
            if (!confirm(t('removeAsk'))) return;
            try {
              if (d.current) { await api('/api/logout', {}); location.reload(); return; }
              await api('/api/revoke', { id: d.id });
              draw((await api('/api/devices')).devices);
            } catch (e) { toast(errText(e), 'err'); }
          }))));
      draw(list.devices);
      dialog(t('phoneTitle'), linkBlock(pair.links, t('phoneHint')), rows);
    } catch (e) { toast(errText(e), 'err'); }
  }

  async function computerDialog() {
    try {
      const r = await api('/api/pair', { kind: 'node' });
      const usable = r.links.filter((l) => !l.local);
      const link = (usable[0] || r.links[0]);
      dialog(t('computerTitle'), h('p', {}, t('computerHint')), codeLine('python -m lonca join ' + link.url),
        link.local ? h('p', { class: 'warn' }, t('localOnly')) : null);
    } catch (e) { toast(errText(e), 'err'); }
  }

  boot();
})();
