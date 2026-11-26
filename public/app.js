(() => {
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const offlineEl = document.getElementById('offline');
  const liveEl = document.getElementById('live');

  let ws = null;
  let view = null;
  let me = load('imposter.me');
  let proKey = localStorage.getItem('imposter.pro') || '';
  let proBusy = false; // checkout request in flight
  let proWatch = null; // poll after returning from Stripe
  let draft = {
    name: (me && me.name) || '',
    code: (me && me.code) || '',
    chat: '',
    custom: '',
    seats: '',
    prokey: '',
    mode: null, // home setup choice: null | 'multi' | 'same'
  };
  let pendingSeats = null; // same-phone names to save once the solo room exists
  let selected = null;
  let lastSig = '';
  let lastPhase = '';
  let pendingResume = Boolean(me && me.code);
  let retryDelay = 400;
  let soloStage = 'handoff'; // handoff | card | ballot
  let customTimer = null;
  let toastTimer = null;
  let enterTimer = null;
  const splashT0 = Date.now();
  // absolute fallback: never trap the user behind the loading logo
  setTimeout(dismissSplash, 4000);

  function dismissSplash() {
    const sp = document.getElementById('splash');
    if (!sp || sp.classList.contains('gone')) return;
    // let the logo read for a beat on fast loads, hide instantly if slow
    const wait = Math.max(0, 700 - (Date.now() - splashT0));
    setTimeout(() => {
      sp.classList.add('gone');
      setTimeout(() => sp.remove(), 450);
    }, wait);
  }

  const MODE_INFO = {
    classic: 'Everyone gets the word. The impostor gets nothing but the category.',
    mysterious: 'The impostor gets a similar word from the same category.',
    chaotic: 'Like mysterious, and the number of impostors is random and hidden.',
  };

  function load(k) {
    try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; }
  }
  function saveMe() {
    if (me) localStorage.setItem('imposter.me', JSON.stringify(me));
    else localStorage.removeItem('imposter.me');
  }
  function saveProKey(k) {
    proKey = k ? String(k).toUpperCase() : '';
    if (proKey) localStorage.setItem('imposter.pro', proKey);
    else localStorage.removeItem('imposter.pro');
  }

  // Poll /api/pro/status until Stripe's webhook flips the key to active.
  async function watchPro(key, tries = 0) {
    clearTimeout(proWatch);
    let st = null;
    try {
      const r = await fetch(`/api/pro/status?key=${encodeURIComponent(key)}`);
      st = await r.json();
    } catch { return; } // offline: the key stays saved and re-sends later
    if (st.active) {
      saveProKey(st.key || key);
      send({ t: 'pro', key: st.key || key });
      toast('Pro unlocked 🎉 Every pack is open.');
      render(true);
      return;
    }
    if (st.status === 'pending' && tries < 20) {
      if (!tries) toast('Payment received — activating Pro…');
      proWatch = setTimeout(() => watchPro(key, tries + 1), 3000);
      return;
    }
    if (st.status === 'invalid' || st.status === 'unknown' || st.status === 'expired') {
      saveProKey('');
      toast('That Pro key is not active.');
      render(true);
    }
  }

  // Coming back from Stripe: /?pro=IMP-…
  function proFromUrl() {
    const raw = new URLSearchParams(location.search).get('pro');
    if (!raw) return;
    history.replaceState(null, '', location.pathname);
    if (raw === 'cancel') return toast('Checkout cancelled — no charge.');
    saveProKey(raw);
    watchPro(raw);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function hue(s) {
    let h = 0;
    for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
  }
  function avatar(name) {
    return `<span class="avatar" aria-hidden="true" style="background:hsl(${hue(name)} 72% 62%)">${esc((name || '?')[0]).toUpperCase()}</span>`;
  }
  function buzz(ms) { if (navigator.vibrate) { try { navigator.vibrate(ms); } catch { /* ignore */ } } }
  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3000);
  }
  function announce(msg) { liveEl.textContent = msg; }

  // tiny confetti burst for the results screen (no dependencies)
  function confetti() {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = document.createElement('canvas');
    cv.className = 'confetti';
    cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = (cv.width = Math.floor(innerWidth * dpr));
    const H = (cv.height = Math.floor(innerHeight * dpr));
    const colors = ['#0b76c1', '#5b3df5', '#d6336c', '#2f7d32', '#f59f00'];
    const bits = Array.from({ length: 140 }, () => ({
      x: Math.random() * W,
      y: -Math.random() * H * 0.5,
      w: (4 + Math.random() * 5) * dpr,
      h: (6 + Math.random() * 8) * dpr,
      vx: (Math.random() - 0.5) * 1.2 * dpr,
      vy: (1.6 + Math.random() * 2.6) * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
      c: colors[(Math.random() * colors.length) | 0],
    }));
    let last = performance.now();
    const t0 = last;
    (function frame(t) {
      const k = Math.min(3, (t - last) / 16.7);
      last = t;
      ctx.clearRect(0, 0, W, H);
      for (const b of bits) {
        b.x += b.vx * k; b.y += b.vy * k; b.rot += b.vr * k; b.vy += 0.03 * dpr * k;
        if (b.y > H + 24) { b.y = -24; b.x = Math.random() * W; b.vy = (1.6 + Math.random() * 2) * dpr; }
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.fillStyle = b.c;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.restore();
      }
      if (t - t0 < 4200) requestAnimationFrame(frame);
      else cv.remove();
    })(last);
  }

  // ------------------------------------------------------------- websocket
  let connectStartedAt = 0;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const sock = new WebSocket(proto + location.host + '/ws');
    ws = sock;
    connectStartedAt = Date.now();
    sock.onopen = () => {
      retryDelay = 400;
      offlineEl.classList.add('hidden');
      if (me && me.code) {
        pendingResume = true;
        send({ t: 'join', code: me.code, name: me.name, resume: me.id, proKey: proKey || undefined });
      }
      // re-assert the host's Pro state after a reconnect
      if (proKey && view && view.isHost) send({ t: 'pro', key: proKey });
      render(true);
    };
    sock.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      handle(m);
    };
    sock.onclose = () => {
      if (ws !== sock) return; // a newer socket took over
      offlineEl.classList.remove('hidden');
      setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 6000);
    };
    sock.onerror = () => {};
  }

  // Watchdog: mobile browsers can leave a socket stuck in CONNECTING (or silently
  // dead) after backgrounding or a network change — force a fresh connection.
  setInterval(() => {
    const stuck = ws && ws.readyState === 0 && Date.now() - connectStartedAt > 8000;
    const dead = !ws || ws.readyState === 2 || ws.readyState === 3;
    if (!dead && !stuck) return;
    if (stuck) { try { ws.close(); } catch { /* ignore */ } }
    offlineEl.classList.remove('hidden');
    connect();
  }, 4000);

  const PHASE_WORDS = {
    lobby: 'Lobby. Waiting for the host to start.',
    reveal: 'Your card is ready. Press and hold to see your word.',
    vote: 'Voting is open. Talk it out, and pick the faker.',
    tally: 'Votes are in.',
    guess: 'The impostor gets one guess at the word.',
    end: 'The round is over.',
  };

  function handle(m) {
    if (m.t === 'you') {
      me = { id: m.id, code: m.code, name: draft.name || (me && me.name) || 'Player' };
      pendingResume = false;
      saveMe();
      render(true);
      return;
    }
    if (m.t === 'room') {
      pendingResume = false;
      view = m;
      if (m.pro && m.pro.key) saveProKey(m.pro.key);
      // one-tap same-phone start: the room was just created, save the seats
      if (pendingSeats && m.solo && m.phase === 'lobby' && !m.players.length) {
        const names = pendingSeats;
        pendingSeats = null;
        send({ t: 'seats', names });
      }
      if (m.solo) { me = { id: m.me, code: m.code, name: draft.name }; localStorage.removeItem('imposter.me'); }
      if (m.phase !== lastPhase) {
        selected = null;
        soloStage = 'handoff';
        lastPhase = m.phase;
        announce(PHASE_WORDS[m.phase] || m.phase);
        // small entrance for the new screen, and confetti when a round ends
        app.classList.remove('enter');
        void app.offsetWidth;
        app.classList.add('enter');
        clearTimeout(enterTimer);
        enterTimer = setTimeout(() => app.classList.remove('enter'), 700);
        if (m.phase === 'end') confetti();
      }
      render();
      return;
    }
    if (m.t === 'pro') {
      saveProKey(m.key);
      render(true);
      return;
    }
    if (m.t === 'error') {
      if (pendingResume) {
        pendingResume = false;
        view = null;
        lastSig = '';
        render(true);
      }
      toast(m.msg);
    }
  }

  // ------------------------------------------------------------ primitives
  function chips(items, current, act, key) {
    return `<div class="picker" role="group">${items.map((it) => `
      <button type="button" class="${String(current) === String(it.v) ? 'on' : ''}" data-act="${act}" data-key="${key}" data-arg="${esc(it.v)}">${esc(it.l)}</button>`).join('')}</div>`;
  }

  function holdCard(word, category, isImpostor, note) {
    return `
      <div class="rolecard ${isImpostor ? 'imp' : 'crew'}">
        <div class="who">${isImpostor ? '🕵 You are the impostor' : '🛡 You are crew'}</div>
        <button type="button" class="holdwrap" data-hold aria-label="Press and hold to reveal your card">
          <span class="holdhint">Press &amp; hold to reveal</span>
          <span class="holdface">
            <span class="cat">${esc(category || '')}</span>
            <span class="word">${word ? esc(word) : 'no word — blend in'}</span>
            ${note ? `<span class="note">${note}</span>` : ''}
          </span>
        </button>
      </div>`;
  }

  function handoffSeat(seat, headline, cta) {
    return `
      <div class="handoff">
        <div class="handoff-icon" aria-hidden="true">📱</div>
        <h2>${esc(headline)}</h2>
        <div class="passchip">${avatar(seat.name)}<span>${esc(seat.name)}</span></div>
        <button type="button" class="primary block big" data-act="seat-ok">${esc(cta || `I'm ${seat.name}`)} — continue</button>
        <p class="muted center">Everyone else: look away. 🙈</p>
      </div>`;
  }

  function statusBar(label, extra) {
    return `<div class="turnbar"><span>${label}</span>${extra ? `<span class="clock">${extra}</span>` : ''}</div>`;
  }

  function chatBox() {
    const open = ['lobby', 'vote', 'tally', 'end'].includes(view.phase);
    return `<div class="card">
      <h3>Chat</h3>
      <div class="chat" data-chat>${view.chat.map((c) => c.id
        ? `<div class="msg"><span class="from">${esc(c.from)}:</span> ${esc(c.text)}</div>`
        : `<div class="msg sys">${esc(c.text)}</div>`).join('') || '<div class="msg sys">Say hi 👋</div>'}</div>
      ${open ? `<form class="chatform" data-form="chat">
        <input type="text" data-k="chat" maxlength="120" placeholder="Message the room…" value="${esc(draft.chat)}" aria-label="Message the room" />
        <button type="submit" class="small">Send</button>
      </form>` : '<div class="muted" style="margin-top:8px">Chat is open in the lobby, while voting, and after the round.</div>'}
    </div>`;
  }

  function scoreboard(compact) {
    const rows = view.players.slice().sort((a, b) => (b.wins || 0) - (a.wins || 0));
    if (!rows.some((r) => r.wins)) return '';
    return `<div class="card">
      <h3>Scoreboard</h3>
      ${rows.map((p) => `
        <div class="tallyrow">
          <span class="name">${esc(p.name)}${p.id === view.me ? ' <span class="muted">(you)</span>' : ''}</span>
          <span class="bar"><span class="fill score" style="width:${Math.min(100, (p.wins || 0) * 20)}%"></span></span>
          <span class="n">${p.wins || 0}</span>
        </div>`).join('')}
      ${compact ? '' : '<p class="muted">One point per round won.</p>'}
    </div>`;
  }

  // ---------------------------------------------------------------- screens
  function screenHome() {
    if (!draft.mode) return screenModePick();
    if (draft.mode === 'same') return screenSamePhone();
    return `
      <div class="brand"><span class="dot" aria-hidden="true"></span><h1>IMPOSTER</h1></div>
      <p class="tag">Everyone gets the same word. One player doesn't. Find them.</p>
      <div class="codebox">
        <div class="hint">DIFFERENT PHONES</div>
        <div class="code" style="font-size:22px;letter-spacing:.12em">EACH PLAYER JOINS</div>
        <div class="hint">Everyone opens the game on their own phone.</div>
      </div>
      <div class="card">
        <label for="nameIn">Your name</label>
        <input id="nameIn" type="text" data-k="name" maxlength="16" placeholder="e.g. Alex" value="${esc(draft.name)}" />
        <div class="spacer"></div>
        <label for="codeIn">Room code <span class="muted" style="font-weight:400">(to join a friend's game)</span></label>
        <input id="codeIn" type="text" data-k="code" maxlength="4" autocapitalize="characters" placeholder="ABCD" value="${esc(draft.code)}" />
        <div class="spacer"></div>
        <div class="row">
          <button type="button" class="primary" data-act="create">Create room</button>
          <button type="button" data-act="join">Join room</button>
        </div>
        ${me && me.code ? `<div class="spacer"></div><button type="button" class="ghost small block" data-act="clearseat">Forget saved room ${esc(me.code)}</button>` : ''}
      </div>
      <button type="button" class="ghost block" data-act="mode" data-arg="">← Different setup</button>
      <details class="card open">
        <summary style="cursor:pointer;font-weight:700">How to play</summary>
        <p class="muted">
          1. Everyone gets a <b>secret word</b> — except the impostor, who secretly gets a different one.<br/>
          2. <b>Discuss</b> together — ask questions, defend yourself.<br/>
          3. <b>Vote</b> out who you think is faking it.<br/>
          4. If the impostor survives the vote, they get <b>one guess</b> at the real word.<br/>
          3–20 players · phone or one shared device.
        </p>
      </details>`;
  }

  function screenModePick() {
    return `
      <div class="brand"><span class="dot" aria-hidden="true"></span><h1>IMPOSTER</h1></div>
      <p class="tag">Everyone gets the same word. One player doesn't. Find them.</p>
      <div class="card">
        <h2 style="margin-top:0">How are you playing?</h2>
        <button type="button" class="primary block big" data-act="mode" data-arg="multi">📱📱 Different phones</button>
        <p class="muted center">Everyone joins on their own phone with a room code.</p>
        <div class="spacer"></div>
        <button type="button" class="block big" data-act="mode" data-arg="same">📱 Same phone</button>
        <p class="muted center">Pass one phone around the table.</p>
        ${me && me.code ? `<div class="spacer"></div><button type="button" class="ghost small block" data-act="clearseat">Forget saved room ${esc(me.code)}</button>` : ''}
      </div>
      <details class="card open">
        <summary style="cursor:pointer;font-weight:700">How to play</summary>
        <p class="muted">
          1. Everyone gets a <b>secret word</b> — except the impostor, who secretly gets a different one.<br/>
          2. <b>Discuss</b> together — ask questions, defend yourself.<br/>
          3. <b>Vote</b> out who you think is faking it.<br/>
          4. If the impostor survives the vote, they get <b>one guess</b> at the real word.<br/>
          3–20 players · separate phones or one shared device.
        </p>
      </details>`;
  }

  function screenSamePhone() {
    const names = draft.seats.split('\n').map((s) => s.trim()).filter(Boolean);
    return `
      <div class="brand"><span class="dot" aria-hidden="true"></span><h1>IMPOSTER</h1></div>
      <div class="codebox">
        <div class="hint">SAME PHONE</div>
        <div class="code" style="font-size:22px;letter-spacing:.12em">PASS &amp; PLAY</div>
        <div class="hint">Everyone plays on this phone. Add the players in seating order.</div>
      </div>
      <div class="card">
        <label for="seatsIn">Player names (one per line, 3–20)</label>
        <textarea id="seatsIn" data-k="seats" rows="6" placeholder="Alex&#10;Sam&#10;Jo">${esc(draft.seats)}</textarea>
        <div class="spacer"></div>
        <button type="button" class="primary block big" data-act="samestart" ${names.length < 3 || pendingSeats ? 'disabled' : ''}>
          ${pendingSeats ? 'Setting up…' : (names.length < 3 ? `Add players (${names.length}/3)` : `Start with ${names.length} players`)}
        </button>
      </div>
      <button type="button" class="ghost block" data-act="mode" data-arg="">← Different setup</button>`;
  }

  function proBlock() {
    const p = view.pro || {};
    const lockedCount = view.categories.filter((c) => c.locked).length;
    const price = esc(p.priceLabel || '$9.90');
    if (p.active) {
      return `<div class="card probanner">
        <div class="prohead"><span class="probadge">PRO</span> <b>Pro is active</b></div>
        <p class="muted" style="margin:6px 0 0">All ${p.packs || 0} extra packs are unlocked for this room. Thanks for supporting the game 💙</p>
      </div>`;
    }
    return `<div class="card upsell" data-pro>
      <div class="prohead"><span class="probadge">PRO</span> <b>${price}/${esc(p.period || 'month')}</b></div>
      <p class="muted" style="margin:6px 0 10px">Unlock ${p.packs || 0} extra packs: niche topics like <b>Anime</b>, <b>Coding</b> and <b>Football</b>, plus silly ones like <b>Memes</b>, <b>Conspiracies</b> and <b>Awkward Moments</b>.</p>
      ${lockedCount ? `<p class="muted" style="margin:0 0 10px">${lockedCount} packs are locked in this room right now.</p>` : ''}
      <button type="button" class="primary block" data-act="subscribe" ${proBusy ? 'disabled' : ''}>${proBusy ? 'Opening checkout…' : `Get Pro — ${price}/month`}</button>
      <details style="margin-top:12px">
        <summary style="cursor:pointer;font-weight:700">I already subscribed</summary>
        <label for="proIn">Your Pro key</label>
        <input id="proIn" type="text" data-k="prokey" maxlength="19" autocapitalize="characters" placeholder="IMP-XXXX-XXXX-XXXX" value="${esc(draft.prokey)}" />
        <div class="spacer"></div>
        <button type="button" class="ghost block" data-act="prokey">Activate key</button>
        <p class="muted" style="margin:8px 0 0">The key is on your Stripe receipt. It stays on this device.</p>
      </details>
      ${p.configured === false ? '<p class="muted" style="margin:10px 0 0">Checkout is not configured on this server yet — use a Pro key above, or set the Stripe keys.</p>' : ''}
    </div>`;
  }

  function settingsPanel() {
    const s = view.settings;
    const cats = [{ key: 'mixed', difficulty: 'Mixed', count: 0, tier: 'free', locked: false }].concat(view.categories);
    return `
      <div class="card">
        <h3>Game mode</h3>
        ${chips(view.modes.map((m) => ({ v: m, l: m[0].toUpperCase() + m.slice(1) })), s.mode, 'set', 'mode')}
        <p class="muted" style="margin:8px 0 0">${MODE_INFO[s.mode] || ''}</p>
        <h3>Category</h3>
        <div class="picker" role="group">
          ${cats.map((c) => `<button type="button" class="${s.category === c.key ? 'on' : ''}${c.locked ? ' locked' : ''}" data-act="${c.locked ? 'paywall' : 'set'}" data-key="category" data-arg="${c.key}">
            ${c.key === 'mixed' ? '🎲 Mixed' : esc(c.key)} <span class="catmeta">${c.locked ? '🔒 PRO' : c.key === 'mixed' ? '' : `${esc(c.difficulty)} · ${c.count}`}</span></button>`).join('')}
        </div>
        <details ${draft.custom ? 'open' : ''}>
          <summary style="cursor:pointer;font-weight:700;margin:10px 0">✏️ Custom word list</summary>
          <label for="customIn">Comma or line separated (5+ words)</label>
          <textarea id="customIn" data-k="custom" rows="3" placeholder="witch, broom, cauldron, spell, hat">${esc(draft.custom)}</textarea>
          <div class="spacer"></div>
          <p class="muted">Saved automatically. Select the <b>Custom</b> category to use it.</p>
        </details>
        <h3>Impostors</h3>
        ${chips([{ v: 'auto', l: 'Auto' }, { v: 1, l: '1' }, { v: 2, l: '2' }, { v: 3, l: '3' }], s.impostors, 'set', 'impostors')}
        <h3>Impostor last guess</h3>
        ${chips([{ v: 'on', l: s.lastGuess ? 'On ✓' : 'On' }, { v: 'off', l: !s.lastGuess ? 'Off ✓' : 'Off' }], s.lastGuess ? 'on' : 'off', 'set', 'lastGuess')}
        <h3>Room size</h3>
        ${chips([{ v: 6, l: '6' }, { v: 12, l: '12' }, { v: 20, l: '20' }], s.maxPlayers, 'set', 'maxPlayers')}
      </div>
      ${proBlock()}`;
  }

  function playerList(interactive) {
    return `<div class="players">${view.players.map((p) => `
      <div class="chip ${p.host ? 'host' : ''} ${p.id === view.me ? 'you' : ''} ${p.alive ? '' : 'out'} ${p.connected ? '' : 'off'}">
        ${avatar(p.name)}
        <span style="overflow:hidden;text-overflow:ellipsis">${esc(p.name)}${p.id === view.me ? ' <span class="muted">(you)</span>' : ''}</span>
        ${p.host ? '<span class="tagpill">HOST</span>' : ''}
        ${!p.connected ? '<span class="tagpill">OFF</span>' : ''}
        ${!p.alive ? '<span class="tagpill outpill">OUT</span>' : ''}
        ${interactive && view.isHost && !view.solo && p.id !== view.me ? `<button type="button" class="kick" data-act="kick" data-arg="${p.id}" aria-label="Remove ${esc(p.name)}">×</button>` : ''}
      </div>`).join('')}</div>`;
  }

  function screenLobby() {
    const count = view.players.filter((p) => p.connected).length;
    const need = view.limits.min;
    return `
      <div class="brand"><span class="dot" aria-hidden="true"></span><h1>IMPOSTER</h1></div>
      <div class="codebox">
        <div class="hint">ROOM CODE</div>
        <div class="code ltrs">${esc(view.code).split('').map((ch) => `<span class="ltr">${esc(ch)}</span>`).join('')}</div>
        <div class="hint">Friends on the same Wi-Fi: open <b>${esc(view.joinUrl || location.host)}</b> and enter this code.</div>
      </div>
      <div class="card">
        <h2>Players — ${count}/${view.settings.maxPlayers}</h2>
        ${playerList(true)}
        <div class="spacer"></div>
        <div class="row">
          <button type="button" class="ghost small" data-act="copy">Copy invite</button>
          ${view.isHost ? `<button type="button" class="ghost small" data-act="transfernext">Transfer host</button>` : ''}
        </div>
      </div>
      ${view.isHost ? settingsPanel() : `<div class="card"><h2>Game settings</h2>
        <p class="muted">Mode: <b>${esc(view.settings.mode)}</b> · Category: <b>${esc(view.settings.category)}</b> · Impostors: <b>${esc(view.settings.impostors)}</b></p>
        <p class="muted">Only the host can change these.</p></div>`}
      ${view.isHost
        ? `<button type="button" class="primary block big" data-act="start" ${count < need ? 'disabled' : ''}>
             ${count < need ? `Start game (need ${need})` : 'Start game'}</button>
           ${count >= 2 && count < need ? `<div class="spacer"></div><button type="button" class="ghost block" data-act="force">Force start with ${count}</button>` : ''}`
        : `<div class="status">Waiting for the host to start…<br/><span class="muted">Need at least ${need} players.</span></div>`}
      ${scoreboard(true)}
      ${chatBox()}
      <details class="card"><summary style="cursor:pointer;font-weight:700">How to play</summary>
        <p class="muted">Discuss, then vote. The impostor blends in; if they survive, they get one guess at the word.</p>
      </details>
      <button type="button" class="ghost block" data-act="leave">Leave room</button>`;
  }

  function screenReveal() {
    if (view.solo) {
      const nextIdx = view.players.findIndex((p) => !p.ready);
      if (nextIdx === -1) return soloWaiting('Everyone has seen their card.', 'Voting starts in a moment…');
      const seat = view.players[nextIdx];
      if (soloStage === 'handoff') return handoffSeat(seat, 'Hand the device over', `Pass to ${seat.name}`);
      wantSeat(nextIdx);
      return `
        ${holdCard(view.yourWord, view.yourCategory, view.youAreImpostor, view.youAreImpostor
          ? 'Keep a straight face. Nobody knows you are faking it.'
          : 'Remember it — you will discuss it together.')}
        <div class="spacer"></div>
        <button type="button" class="primary block big" data-act="ready">Hide &amp; pass on</button>`;
    }
    return `
      ${holdCard(view.yourWord, view.yourCategory, view.youAreImpostor, view.youAreImpostor
        ? 'You have a different word from the crew. Act like you know theirs — then, if you survive the vote, guess the real word to win.'
        : 'Remember it — discuss without saying it outright.')}
      <div class="spacer"></div>
      ${view.ready
        ? `<div class="status">✅ You're in. Waiting for <b>${view.players.filter((p) => p.ready).length}/${view.players.filter((p) => p.connected).length}</b> players…</div>`
        : `<button type="button" class="primary block big" data-act="ready">I've seen my word — I'm ready</button>`}
      <div class="muted center">Don't say your word out loud yet! 🤫</div>`;
  }

  function soloWaiting(title, sub) {
    return `
      <div class="status" style="padding-top:40px"><b>${esc(title)}</b><br/><span class="muted">${esc(sub || '')}</span></div>`;
  }

  function ballot() {
    const others = view.players.filter((p) => p.alive && p.id !== view.me);
    return `
      <div class="card">
        <div class="ballot">
          ${others.map((p) => `
            <button type="button" class="vote ${selected === p.id ? 'sel' : ''}" data-act="pick" data-arg="${p.id}">
              ${avatar(p.name)}<span>${esc(p.name)}</span>
            </button>`).join('')}
        </div>
        <div class="spacer"></div>
        <button type="button" class="danger block big" data-act="votego" ${selected ? '' : 'disabled'}>
          ${selected ? `Vote ${esc((view.players.find((p) => p.id === selected) || {}).name || '')}` : 'Pick someone to vote'}
        </button>
        <div class="spacer"></div>
        <button type="button" class="ghost block" data-act="votego" data-arg="skip">Skip — I can't tell</button>
      </div>`;
  }

  function screenVote() {
    const voters = view.players.filter((p) => p.alive && (view.solo || p.connected));
    const votedCount = voters.filter((p) => p.voted).length;
    if (view.solo) {
      const nextVoter = view.players.find((p) => p.alive && !p.voted);
      if (!nextVoter) return `<div class="status">All votes are in…</div>`;
      const idx = view.players.findIndex((p) => p.id === nextVoter.id);
      if (soloStage === 'handoff') {
        return `${statusBar(`Voting — ${votedCount}/${voters.length} done`)}${handoffSeat(nextVoter, 'Time to vote', `Pass to ${nextVoter.name}`)}`;
      }
      wantSeat(idx);
      return `${statusBar(`${esc(nextVoter.name)} is voting`)}${ballot()}`;
    }
    if (view.myVote) {
      return `
        ${statusBar('🗳 Vote locked in', `${votedCount}/${voters.length}`)}
        <div class="status">You voted for <b>${view.myVote === 'skip' ? 'no one (skip)' : esc(nameOf(view.myVote))}</b>.<br/>
        <span class="muted">Waiting for ${voters.length - votedCount} more…</span></div>
        ${playerList(false)}
        ${chatBox()}
        ${!view.solo && view.isHost ? '<div class="spacer"></div><button type="button" class="ghost block" data-act="advance">Close voting &amp; reveal</button>' : ''}`;
    }
    return `
      ${statusBar('🗳 Who is the impostor?', `${votedCount}/${voters.length}`)}
      ${ballot()}
      <div class="muted center">One vote each. Talk it out, choose carefully.</div>
      ${chatBox()}
      ${!view.solo && view.isHost ? '<div class="spacer"></div><button type="button" class="ghost block" data-act="advance">Close voting &amp; reveal</button>' : ''}`;
  }

  function nameOf(id) {
    const p = view.players.find((x) => x.id === id);
    return p ? p.name : 'someone';
  }

  function screenTally() {
    const counts = view.voteCounts || {};
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...rows.map((r) => r[1]));
    const out = view.eliminatedNow;
    const host = view.isHost;
    return `
      ${statusBar('🗳 The votes are in')}
      <div class="card">
        ${rows.length ? rows.map(([id, n]) => `
          <div class="tallyrow">
            <span class="name">${id === 'skip' ? '⏭ skip' : esc(nameOf(id))}</span>
            <span class="bar"><span class="fill" style="width:${(n / max) * 100}%"></span></span>
            <span class="n">${n}</span>
          </div>`).join('') : '<div class="status">Nobody voted.</div>'}
      </div>
      ${out ? `
        <div class="result ${out.isImpostor ? 'imp' : 'crew'}">
          <div class="emoji">${out.isImpostor ? '🕵️' : '🪦'}</div>
          <div class="title">${esc(out.name)} is out</div>
          <div class="reason">They were ${out.isImpostor ? 'the impostor' : 'innocent crew'}. ${out.votes} vote${out.votes === 1 ? '' : 's'}.</div>
        </div>`
        : '<div class="status">No clear suspect — nobody was eliminated.</div>'}
      ${host ? `<div class="spacer"></div><button type="button" class="primary block big" data-act="continue">Continue</button>` : ''}`;
  }

  function screenGuess() {
    if (view.solo) {
      const outImp = [...view.eliminated].reverse().find((e) => e.isImpostor);
      if (outImp) {
        const idx = view.players.findIndex((p) => p.id === outImp.id);
        if (idx !== -1) wantSeat(idx);
      }
    }
    if (view.guessOptions) {
      return `
        <div class="turnbar"><span>🕵 Your last chance</span></div>
        <div class="card">
          <div class="status">You were voted out — but you can <b>steal the win</b>: guess the crew's word.</div>
          <div class="options">
            ${view.guessOptions.map((w) => `<button type="button" class="block" data-act="guess" data-arg="${esc(w)}">${esc(w)}</button>`).join('')}
          </div>
        </div>`;
    }
    return `
      <div class="turnbar"><span>🕵 The impostor is guessing…</span></div>
      <div class="status">The impostor was voted out and gets <b>one shot</b> at the secret word.<br/><span class="muted">Fingers crossed they pick wrong. 🤞</span></div>
      ${playerList(false)}`;
  }

  function screenEnd() {
    const crewWon = view.winner === 'crew';
    return `
      <div class="result ${crewWon ? 'crew' : 'imp'}">
        <div class="emoji">${crewWon ? '🛡️' : '🕵️'}</div>
        <div class="title">${crewWon ? 'CREW WINS' : 'IMPOSTOR WINS'}</div>
        <div class="reason">${esc(view.reason || '')}</div>
        <div class="secret">the word was “${esc(view.roundWord || '')}”</div>
        <div class="reason">${esc(view.roundCategory || '')} · ${esc(view.roundMode || '')} · ${view.impostorCount || '?'} impostor${(view.impostorCount || 1) === 1 ? '' : 's'}</div>
      </div>
      <div class="spacer"></div>
      <div class="card">
        <h2>Who was who</h2>
        ${view.players.map((p) => `
          <div class="chip" style="margin-bottom:8px">
            ${avatar(p.name)}
            <span style="overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span>
            <span class="badge ${p.impostor ? 'imp' : 'crew'}" style="margin-left:auto">${p.impostor ? 'IMPOSTOR' : 'crew'}</span>
          </div>`).join('')}
      </div>
      ${scoreboard(false)}
      ${view.isHost ? `<button type="button" class="primary block big" data-act="again">Play again</button>`
        : `<div class="status muted">${view.solo ? '' : 'Waiting for the host to start another round…'}</div>`}
      ${view.solo ? '' : chatBox()}
      <button type="button" class="ghost block" data-act="leave">Leave room</button>`;
  }

  // -------------------------------------------------------------- rendering
  function wantSeat(index) {
    if (view && view.solo && view.activeSeat !== index) send({ t: 'seat', index });
  }

  function screenFor() {
    switch (view.phase) {
      case 'lobby': return view.solo ? screenSoloLobby() : screenLobby();
      case 'reveal': return screenReveal();
      case 'clues': return screenVote();
      case 'vote': return screenVote();
      case 'tally': return screenTally();
      case 'guess': return screenGuess();
      case 'end': return screenEnd();
      default: return screenLobby();
    }
  }

  function screenSoloLobby() {
    return `
      <div class="brand"><span class="dot" aria-hidden="true"></span><h1>IMPOSTER</h1></div>
      <div class="codebox">
        <div class="hint">PASS &amp; PLAY</div>
        <div class="code" style="font-size:26px;letter-spacing:.1em">${view.players.length} PLAYERS</div>
        <div class="hint">${view.players.map((p) => esc(p.name)).join(' · ')}</div>
      </div>
      ${settingsPanel()}
      <button type="button" class="primary block big" data-act="start" ${view.players.length < 3 ? 'disabled' : ''}>Start game</button>
      <div class="spacer"></div>
      <button type="button" class="ghost block" data-act="leave">Cancel</button>`;
  }

  function render(force) {
    if (!view) { lastSig = ''; app.innerHTML = screenHome(); afterRender(); return; }
    if (!view.solo && view.players && view.players.length && !view.players.some((p) => p.id === view.me)) {
      view = null; me = null; saveMe(); lastSig = ''; lastPhase = '';
      app.innerHTML = screenHome(); afterRender(); return;
    }
    const sig = JSON.stringify(view);
    if (!force && sig === lastSig) return;
    lastSig = sig;

    const active = document.activeElement;
    const focusKey = active && active.dataset ? active.dataset.k : null;
    const caret = focusKey && active.selectionStart != null ? active.selectionStart : null;

    app.innerHTML = screenFor();
    afterRender();

    if (focusKey) {
      const el = app.querySelector(`[data-k="${focusKey}"]`);
      if (el) {
        el.focus();
        try { el.setSelectionRange(caret, caret); } catch { /* n/a */ }
      }
    }
  }

  function afterRender() {
    const chat = app.querySelector('[data-chat]');
    if (chat) chat.scrollTop = chat.scrollHeight;
    dismissSplash();
  }

  // ----------------------------------------------------------------- events
  const readInput = (k) => {
    const el = app.querySelector(`[data-k="${k}"]`);
    return el ? el.value : '';
  };

  document.addEventListener('input', (e) => {
    const k = e.target && e.target.dataset ? e.target.dataset.k : null;
    if (!k) return;
    draft[k] = e.target.value;
    if (k === 'custom') {
      clearTimeout(customTimer);
      customTimer = setTimeout(() => send({ t: 'settings', customWords: draft.custom }), 700);
    }
    // same-phone player count: update the Start button in place so the
    // textarea keeps focus — a full re-render here drops the keyboard
    if (k === 'seats') {
      const names = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 20);
      const btn = app.querySelector('[data-act="samestart"]');
      if (btn) {
        btn.disabled = names.length < 3 || !!pendingSeats;
        btn.textContent = pendingSeats ? 'Setting up…'
          : (names.length < 3 ? `Add players (${names.length}/3)` : `Start with ${names.length} players`);
      }
      return;
    }
  });

  document.addEventListener('submit', (e) => {
    const form = e.target;
    e.preventDefault();
    if (form.dataset.form === 'chat') {
      const t = readInput('chat').trim();
      if (!t) return;
      send({ t: 'chat', text: t });
      draft.chat = '';
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target && e.target.dataset.k === 'code') {
      e.preventDefault();
      act('join');
    }
  });

  // press & hold reveal
  let holding = null;
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest && e.target.closest('[data-hold]');
    if (!el) return;
    holding = el;
    el.classList.add('on');
    buzz(15);
  });
  const release = () => {
    if (!holding) return;
    holding.classList.remove('on');
    holding = null;
  };
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
  document.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && e.target && e.target.matches && e.target.matches('[data-hold]')) {
      e.preventDefault();
      e.target.classList.add('on');
      holding = e.target;
      buzz(15);
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.target && e.target.matches && e.target.matches('[data-hold]')) release();
  });

  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-act]');
    if (!el) return;
    act(el.dataset.act, el.dataset.arg, el.dataset.key);
  });

  function act(action, arg, key) {
    switch (action) {
      case 'create': {
        const name = readInput('name').trim();
        if (!name) return toast('Enter your name first.');
        draft.name = name;
        send({ t: 'create', name, proKey: proKey || undefined });
        break;
      }
      case 'join': {
        const name = readInput('name').trim();
        const code = readInput('code').trim().toUpperCase();
        if (!name) return toast('Enter your name first.');
        if (code.length !== 4) return toast('Room codes are 4 characters.');
        draft.name = name;
        draft.code = code;
        send({ t: 'join', code, name, proKey: proKey || undefined });
        break;
      }
      case 'mode':
        draft.mode = arg || null;
        render(true);
        break;
      case 'samestart': {
        if (pendingSeats) return toast('Setting up…');
        const names = draft.seats.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 20);
        if (names.length < 3) return toast('Add at least 3 players.');
        pendingSeats = names;
        render(true);
        send({ t: 'create', name: names[0], solo: true, proKey: proKey || undefined });
        break;
      }
      case 'clearseat':
        me = null; saveMe(); draft.code = ''; view = null; render(true);
        break;
      case 'start': send({ t: 'start' }); break;
      case 'force': send({ t: 'start', force: true }); break;
      case 'ready': send({ t: 'ready' }); soloStage = 'handoff'; break;
      case 'continue': send({ t: 'continue' }); break;
      case 'advance': send({ t: 'advance' }); break;
      case 'again': send({ t: 'again' }); break;
      case 'seat-ok': soloStage = soloStage === 'handoff' && view.phase === 'vote' ? 'ballot' : 'card';
        render(true);
        break;
      case 'set': {
        const patch = { [key]: arg === 'auto' || arg === 'on' || arg === 'off' ? arg : (isNaN(Number(arg)) ? arg : Number(arg)) };
        if (key === 'lastGuess') patch.lastGuess = arg === 'on';
        if (key === 'impostors') patch.impostors = arg === 'auto' ? 'auto' : Number(arg);
        send({ t: 'settings', ...patch });
        break;
      }
      case 'pick': selected = arg; render(true); break;
      case 'votego': send({ t: 'vote', target: arg || selected }); selected = null; soloStage = 'handoff'; break;
      case 'guess': send({ t: 'guess', word: arg }); break;
      case 'kick': send({ t: 'kick', id: arg }); break;
      case 'transfernext': {
        const next = view.players.find((p) => p.connected && p.id !== view.me);
        if (next) send({ t: 'transfer', id: next.id });
        else toast('Nobody else to transfer to.');
        break;
      }
      case 'paywall': {
        toast('That pack is part of Pro 👇');
        const el = app.querySelector('[data-pro]');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      }
      case 'subscribe': {
        if (proBusy) return toast('Opening checkout…');
        proBusy = true;
        render(true);
        fetch('/api/pro/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          .then(async (r) => {
            const data = await r.json().catch(() => ({}));
            if (!r.ok || !data.url) throw new Error(data.message || 'Checkout is not available right now.');
            if (data.key) saveProKey(data.key);
            location.href = data.url;
          })
          .catch((err) => toast(err.message))
          .finally(() => { proBusy = false; render(true); });
        break;
      }
      case 'prokey': {
        const k = readInput('prokey').trim().toUpperCase();
        if (!k) return toast('Enter the key from your receipt.');
        saveProKey(k);
        send({ t: 'pro', key: k });
        watchPro(k);
        break;
      }
      case 'copy': {
        const text = `Join my IMPOSTER game! Open ${view.joinUrl || location.host} and enter code ${view.code}`;
        if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
        toast('Invite copied ✅');
        break;
      }
      case 'leave':
        send({ t: 'leave' });
        me = null; saveMe(); view = null; lastSig = ''; lastPhase = '';
        draft.mode = null; pendingSeats = null;
        render(true);
        break;
    }
  }

  // PWA
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  proFromUrl();
  render(true);
  connect();
})();
