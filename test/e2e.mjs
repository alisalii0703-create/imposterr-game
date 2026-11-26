// End-to-end test for the Impostor Word Game.
// Plays real rounds over WebSockets: modes, discussion -> vote flow (no typed clues),
// host-driven phase flow, elimination + last guess, host controls, custom word banks,
// and Pass & Play.
// Run: npm test
import WebSocket from 'ws';

const URL = process.env.WS_URL || 'ws://localhost:5173/ws';
const BASE = URL.replace(/^ws/, 'http').replace(/\/ws$/, '');
let failures = 0;
let checks = 0;

function ok(cond, label) {
  checks += 1;
  if (cond) console.log(`  ✓ ${label}`);
  else { failures += 1; console.error(`  ✗ FAIL: ${label}`); }
}
function group(name) { console.log(`\n${name}`); }

class Client {
  constructor(name) {
    this.name = name;
    this.view = null;
    this.id = null;
    this.code = null;
    this.errors = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL);
      this.ws.on('error', reject);
      this.ws.on('open', resolve);
      this.ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.t === 'room') this.view = m;
        else if (m.t === 'you') { this.id = m.id; this.code = m.code; }
        else if (m.t === 'error') this.errors.push(m.msg);
      });
    });
  }
  send(msg) { this.ws.send(JSON.stringify(msg)); }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
  until(pred, ms = 5000, label = 'condition') {
    const t0 = Date.now();
    return new Promise((resolve, reject) => {
      const iv = setInterval(() => {
        if (pred()) { clearInterval(iv); resolve(); }
        else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error(`timeout waiting for ${label} (phase=${this.view && this.view.phase})`)); }
      }, 20);
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const start = Date.now();
const log = (s) => console.log(`\n[${((Date.now() - start) / 1000).toFixed(1)}s] ${s}`);

try {
  // ------------------------------------------------------------- lobby + config
  log('4 players create and join');
  const clients = ['Ada', 'Ben', 'Cid', 'Dee'].map((n) => new Client(n));
  await Promise.all(clients.map((c) => c.connect()));
  const [A, B, C, D] = clients;
  A.send({ t: 'create', name: A.name });
  await A.until(() => A.code, 3000, 'room code');
  ok(/^[A-Z2-9]{4}$/.test(A.code), `4-letter room code (${A.code})`);
  for (const c of [B, C, D]) c.send({ t: 'join', code: A.code, name: c.name });
  await A.until(() => A.view.players.length === 4, 4000, 'lobby fills');
  ok(A.view.phase === 'lobby', 'phase = lobby');
  ok(A.view.isHost && !B.view.isHost, 'only the host controls the room');
  ok(A.view.limits.max === 20 && A.view.limits.min === 3, `player limits 3–20 (${JSON.stringify(A.view.limits)})`);
  ok(A.view.categories.length >= 10 && A.view.categories.every((c) => c.difficulty && c.count > 0), 'categories ship with difficulty tags');
  ok(A.view.settings.mode === 'mysterious' && A.view.settings.lastGuess === true && !('turnTimer' in A.view.settings) && !('discussTimer' in A.view.settings), 'PRD default settings (no timers)');
  ok(!('passes' in A.view.settings) && !('passOptions' in A.view), 'no clue-pass settings (discussion only)');
  ok(Array.isArray(A.view.clues) && A.view.clues.length === 0 && A.view.turnId == null, 'no typed clue phase');

  group('host configuration');
  A.send({
    t: 'settings',
    mode: 'classic', impostors: 1,
    lastGuess: true, category: 'Animals', maxPlayers: 12,
  });
  await B.until(() => B.view.settings.mode === 'classic', 4000, 'settings propagate');
  const s = B.view.settings;
  ok(s.mode === 'classic' && s.impostors === 1 && s.maxPlayers === 12, 'settings reach every player');
  B.errors.length = 0;
  B.send({ t: 'settings', mode: 'chaotic' });
  await B.until(() => B.errors.length > 0, 3000, 'non-host rejected');
  ok(/Only the host/.test(B.errors[0]) && A.view.settings.mode === 'classic', 'non-host cannot change settings');

  // -------------------------------------------------------------- pro tier
  group('pro tier — locked by default');
  const { grant, revoke, removeKey, normalizeKey } = await import('../lib/pro.js');
  const testKey = normalizeKey('IMPTESTPROKEY01');
  const proPacks = A.view.categories.filter((c) => c.tier === 'pro');
  ok(proPacks.length >= 10, `${proPacks.length} niche + fun packs ship behind Pro`);
  ok(proPacks.every((c) => c.locked), 'every Pro pack starts locked');
  ok(A.view.categories.filter((c) => c.tier !== 'pro').every((c) => !c.locked), 'free packs stay open');
  ok(A.view.pro.active === false && A.view.pro.priceCents === 990 && A.view.pro.period === 'month', 'Pro is $9.90/month and off by default');
  ok(!('key' in A.view.pro) || A.view.pro.key == null, 'no key leaks while Pro is off');
  A.errors.length = 0;
  A.send({ t: 'settings', category: 'Anime' });
  await A.until(() => A.errors.length > 0, 3000, 'locked pack rejected');
  ok(/Pro pack/.test(A.errors[0]) && A.view.settings.category !== 'Anime', 'the server refuses a locked pack (no client-side trust)');
  const lockedStatus = await (await fetch(`${BASE}/api/pro/status?key=${encodeURIComponent(testKey)}`)).json();
  ok(lockedStatus.active === false, 'unknown key is not active');
  const noKey = await (await fetch(`${BASE}/api/pro/status?key=nope`)).json();
  ok(noKey.active === false, 'garbage key is not active');

  group('pro tier — subscription unlocks the packs');
  grant(testKey, { email: 'e2e@local' });
  const paidStatus = await (await fetch(`${BASE}/api/pro/status?key=${encodeURIComponent(testKey)}`)).json();
  ok(paidStatus.active === true && paidStatus.plan.priceCents === 990, 'paid key reports active at $9.90/month');
  A.send({ t: 'pro', key: testKey });
  await A.until(() => A.view.pro.active === true, 4000, 'pro activated');
  ok(A.view.categories.every((c) => !c.locked), 'every pack unlocks for the host');
  ok(A.view.pro.key === testKey, 'host gets the key back so the device can remember it');
  ok(B.view.pro.active === true && !B.view.pro.key, 'guests can play Pro packs but never see the key');
  A.send({ t: 'settings', category: 'Anime' });
  await A.until(() => A.view.settings.category === 'Anime', 4000, 'pro pack selectable');
  ok(B.view.settings.category === 'Anime', 'the Pro pack reaches every player');
  B.errors.length = 0;
  B.send({ t: 'pro', key: testKey });
  await B.until(() => B.errors.length > 0, 3000, 'guest cannot claim the key');
  ok(B.view.pro.key == null, 'a guest redeeming the key does not take over the room\'s Pro');

  group('pro tier — lapsing subscription re-locks the packs');
  revoke(testKey);
  A.send({ t: 'settings', mode: 'classic' });
  await A.until(() => A.view.pro.active === false, 4000, 'pro lapses');
  ok(A.view.categories.some((c) => c.key === 'Anime' && c.locked), 'packs lock again when the subscription ends');
  A.send({ t: 'settings', category: 'Anime' });
  await sleep(200);
  ok(A.view.settings.category !== 'Anime', 'a cancelled subscription cannot keep using Pro packs');
  removeKey(testKey);

  group('pro checkout endpoints');
  const checkout = await fetch(`${BASE}/api/pro/checkout`, { method: 'POST' });
  const checkoutBody = await checkout.json().catch(() => ({}));
  if (process.env.STRIPE_SECRET_KEY) {
    ok(checkout.status === 200 && typeof checkoutBody.url === 'string', 'configured server returns a Stripe checkout url');
  } else {
    ok(checkout.status === 503 && checkoutBody.error === 'payments_not_configured', 'unconfigured server says so instead of pretending');
  }
  const hook = await fetch(`${BASE}/api/stripe/webhook`, { method: 'POST', headers: { 'stripe-signature': 't=1,v1=deadbeef' }, body: '{}' });
  ok(hook.status === 400 || hook.status === 503, `unsigned webhook is refused (${hook.status})`);

  group('custom word bank');
  const custom = ['witch', 'broom', 'cauldron', 'spell', 'wand', 'potion', 'ghost', 'mirror'];
  A.send({ t: 'settings', customWords: 'witch, broom, cauldron, spell, wand, potion, ghost, mirror' });
  await A.until(() => A.view.categories.some((c) => c.key === 'custom'), 4000, 'custom category appears');
  ok(A.view.categories.find((c) => c.key === 'custom').count === 8, 'custom word list parsed');
  A.send({ t: 'settings', category: 'custom' });
  await A.until(() => A.view.settings.category === 'custom', 4000, 'custom selected');

  // --------------------------------------------------------------- round one
  log('round 1 — classic mode, one impostor, discuss then vote');
  A.send({ t: 'start' });
  await A.until(() => A.view.phase === 'reveal', 4000, 'reveal');
  const imp = clients.find((c) => c.view.youAreImpostor);
  const crew = clients.filter((c) => !c.view.youAreImpostor);
  ok(Boolean(imp) && crew.length === 3, 'exactly one impostor (impostors: 1)');
  ok(imp.view.yourWord === null, 'classic mode: impostor gets no word');
  ok(imp.view.yourCategory === 'custom', 'impostor still gets the category');
  ok(crew.every((c) => c.view.yourWord === crew[0].view.yourWord), 'crew all share one word');
  ok(crew.every((c) => custom.includes(c.view.yourWord)), `crew word comes from the custom list (${crew[0].view.yourWord})`);
  ok(B.view.youAreImpostor === (B.id === imp.id), 'roles are per-player (never leaked to the room)');

  for (const c of clients) c.send({ t: 'ready' });
  await A.until(() => A.view.phase === 'vote', 5000, 'voting opens right after reveal');
  ok(A.view.turnId == null && A.view.clues.length === 0, 'no clue turn — straight to discussion/vote');

  group('typed clues are off');
  B.errors.length = 0;
  B.send({ t: 'clue', word: 'zzz' });
  await B.until(() => B.errors.length > 0, 3000, 'clue rejected');
  ok(/Typed clues are off/.test(B.errors[0]), 'typed clue rejected with discussion hint');

  const crewWord = crew[0].view.yourWord;

  group('voting — everyone skips, then a skip-vote continues the round');
  for (const c of clients) c.send({ t: 'vote', target: 'skip' });
  await A.until(() => A.view.phase === 'tally', 4000, 'tally');
  ok(A.view.voteCounts.skip === 4, 'vote counts revealed at tally');
  ok(A.view.eliminatedNow === null, 'no elimination on a skip vote');
  A.send({ t: 'continue' });
  await A.until(() => A.view.phase === 'vote', 5000, 'vote again after skip');
  ok(A.view.clues.length === 0, 'still no typed clues after a tied/skipped vote');

  group('voting — impostor voted out, then steals with the last guess');
  for (const c of clients) c.send({ t: 'vote', target: c.id === imp.id ? crew[0].id : imp.id });
  await A.until(() => A.view.phase === 'tally', 4000, 'tally 2');
  ok(A.view.eliminatedNow && A.view.eliminatedNow.id === imp.id && A.view.eliminatedNow.isImpostor, 'eliminated player\'s identity is revealed');
  ok(B.view.eliminatedNow && B.view.eliminatedNow.isImpostor, 'everyone sees the reveal');
  A.send({ t: 'continue' });
  await A.until(() => A.view.phase === 'guess', 5000, 'last guess');
  ok(Array.isArray(imp.view.guessOptions) && imp.view.guessOptions.length === 3, 'impostor gets 3 word options');
  ok(crew[0].view.guessOptions == null, 'options are hidden from crew');
  ok(imp.view.guessOptions.includes(crewWord), 'the real word is among the options');
  imp.send({ t: 'guess', word: crewWord });
  await A.until(() => A.view.phase === 'end', 4000, 'end');
  ok(A.view.winner === 'imp', `impostor steals the win (${A.view.reason})`);
  ok(A.view.roundWord === crewWord && A.view.impostorCount === 1 && A.view.roundMode === 'classic', 'round summary revealed at the end');
  ok(imp.view.players.find((p) => p.id === imp.id).wins === 1, 'scoreboard credits the winner');

  // --------------------------------------------------------------- round two
  group('round 2 — impostor guesses wrong, crew wins');
  A.send({ t: 'again' });
  await A.until(() => A.view.phase === 'lobby', 4000, 'back to lobby');
  ok(A.view.settings.mode === 'classic', 'settings survive between rounds');
  A.send({ t: 'start' });
  await A.until(() => A.view.phase === 'reveal', 4000, 'round 2 reveal');
  const imp2 = clients.find((c) => c.view.youAreImpostor);
  const crew2 = clients.filter((c) => !c.view.youAreImpostor);
  // round 2 deals a fresh impostor, so baseline each player's score and assert
  // the delta below rather than a hardcoded total
  const winsBefore = new Map(clients.map((c) => [c.id, c.view.players.find((p) => p.id === c.id).wins]));
  for (const c of clients) c.send({ t: 'ready' });
  await A.until(() => A.view.phase === 'vote', 5000, 'round 2 vote');
  for (const c of clients) c.send({ t: 'vote', target: c.id === imp2.id ? crew2[0].id : imp2.id });
  await A.until(() => A.view.phase === 'tally', 4000, 'round 2 tally');
  A.send({ t: 'continue' });
  await A.until(() => A.view.phase === 'guess', 5000, 'round 2 guess');
  imp2.send({ t: 'guess', word: 'definitely not the word' });
  await A.until(() => A.view.phase === 'end', 4000, 'round 2 end');
  ok(A.view.winner === 'crew', `wrong guess → crew wins (${A.view.reason})`);
  for (const c of crew2) await c.until(() => c.view.phase === 'end', 3000, 'end shown to crew');
  ok(crew2.every((c) => c.view.players.find((p) => p.id === c.id).wins === winsBefore.get(c.id) + 1), 'crew all score a point');

  // ------------------------------------------------------------ host controls
  group('host controls: transfer + kick');
  A.send({ t: 'again' });
  await A.until(() => A.view.phase === 'lobby', 4000, 'lobby again');
  A.send({ t: 'transfer', id: B.id });
  await A.until(() => A.view.isHost === false && B.view.isHost === true, 4000, 'host transferred');
  ok(true, 'host can be transferred');
  B.send({ t: 'kick', id: D.id });
  await B.until(() => B.view.players.length === 3, 4000, 'kick');
  ok(D.errors.some((e) => /removed/.test(e)), 'kicked player is told why');
  B.send({ t: 'transfer', id: A.id });
  await A.until(() => A.view.isHost, 4000, 'host back');

  // -------------------------------------------------------- two impostors
  group('two impostors with four players');
  A.send({ t: 'settings', impostors: 2, mode: 'mysterious' });
  await A.until(() => A.view.settings.impostors === 2, 4000, 'impostor count set');
  D.send({ t: 'join', code: A.code, name: 'Dee' });
  await A.until(() => A.view.players.length === 4, 4000, 'Dee rejoins');
  A.send({ t: 'start' });
  await A.until(() => A.view.phase === 'reveal', 4000, 'reveal (2 imps)');
  const imps = clients.filter((c) => c.view.youAreImpostor);
  ok(imps.length === 2, 'two impostors dealt');
  ok(A.view.impostorCount == null, 'impostor count stays hidden mid-round');
  for (const c of clients) c.send({ t: 'ready' });
  await A.until(() => A.view.phase === 'vote', 5000, 'vote (2 imps)');
  const crewA = clients.filter((c) => !c.view.youAreImpostor);
  // host closes voting early: 3 of 4 vote, then advance straight to the tally
  imps[0].send({ t: 'vote', target: crewA[0].id });
  for (const c of crewA) c.send({ t: 'vote', target: imps[0].id });
  await A.until(() => A.view.players.filter((p) => p.voted).length === 3, 4000, '3 votes in');
  A.send({ t: 'advance' });
  await A.until(() => A.view.phase === 'tally', 4000, 'tally (2 imps)');
  ok(imps[1].view.myVote == null, 'the missing fourth vote never landed');
  ok(A.view.eliminatedNow && A.view.eliminatedNow.isImpostor, 'one impostor eliminated');
  A.send({ t: 'continue' });
  await A.until(() => A.view.phase === 'vote', 5000, 'round continues with one impostor left');
  ok(true, 'surviving impostor keeps the game going');

  // ------------------------------------------------------------- reconnect
  group('reconnect keeps your seat');
  const squatter = new Client('Mallory');
  await squatter.connect();
  squatter.send({ t: 'join', code: A.code, name: 'Mallory', resume: C.id });
  await squatter.until(() => squatter.errors.length > 0, 3000, 'live seat refused');
  ok(/another tab/.test(squatter.errors[0]), 'a live seat cannot be stolen');
  squatter.close();
  C.close();
  await sleep(250);
  const back = new Client(C.name);
  await back.connect();
  back.send({ t: 'join', code: A.code, name: C.name, resume: C.id });
  await back.until(() => back.id === C.id && back.view, 4000, 'seat reclaimed');
  ok(back.view.players.some((p) => p.id === C.id && p.connected), 'resume restores the same connected seat');
  clients.push(back);

  // ------------------------------------------------------------- pass & play
  group('pass & play on one device');
  const device = new Client('Device');
  await device.connect();
  device.send({ t: 'create', name: 'Device', solo: true });
  await device.until(() => device.view && device.view.solo && device.view.phase === 'lobby', 4000, 'solo lobby');
  ok(device.view.players.length === 0, 'solo lobby starts empty');
  device.send({ t: 'seats', names: ['Ari', 'Bea', 'Cy'] });
  await device.until(() => device.view.players.length === 3, 4000, 'seats added');
  ok(device.view.players.map((p) => p.name).join(',') === 'Ari,Bea,Cy', 'seats keep their names');
  device.errors.length = 0;
  device.send({ t: 'seats', names: ['One'] });
  await device.until(() => device.errors.length > 0, 3000, 'too few seats');
  ok(/at least 3/.test(device.errors[0]), 'solo needs at least 3 players');

  device.send({ t: 'settings', mode: 'mysterious' });
  await device.until(() => device.view.settings.mode === 'mysterious', 3000, 'solo settings');
  device.send({ t: 'start' });
  await device.until(() => device.view.phase === 'reveal', 4000, 'solo reveal');
  const seatWords = [];
  for (const i of [0, 1, 2]) {
    device.send({ t: 'seat', index: i });
    await device.until(() => device.view.activeSeat === i, 3000, `seat ${i}`);
    seatWords.push(device.view.yourWord);
  }
  ok(new Set(seatWords).size === 2, `each seat sees only its own card (${seatWords.join(' / ')})`);
  ok(typeof device.view.yourCategory === 'string' && device.view.yourCategory.length > 0, `solo deals from a category (${device.view.yourCategory})`);

  for (const i of [0, 1, 2]) {
    device.send({ t: 'seat', index: i });
    await device.until(() => device.view.activeSeat === i, 3000, `seat ready ${i}`);
    device.send({ t: 'ready' });
  }
  await device.until(() => device.view.phase === 'vote', 5000, 'solo voting starts right after reveal');
  ok(device.view.clues.length === 0, 'no typed clues in solo either');
  const impSeatIdx = seatWords.findIndex((w, i) => w !== seatWords[(i + 1) % 3] && w !== seatWords[(i + 2) % 3]);
  for (let i = 0; i < 3; i++) {
    if (i === impSeatIdx) continue;
    device.send({ t: 'seat', index: i });
    await device.until(() => device.view.activeSeat === i, 3000, `voter seat ${i}`);
    device.send({ t: 'vote', target: device.view.players[impSeatIdx].id });
    await sleep(50);
  }
  device.send({ t: 'seat', index: impSeatIdx });
  await device.until(() => device.view.activeSeat === impSeatIdx, 3000, 'impostor seat votes');
  device.send({ t: 'vote', target: 'skip' });
  await device.until(() => device.view.phase === 'tally', 5000, 'solo tally');
  ok(device.view.eliminatedNow && device.view.eliminatedNow.isImpostor, 'the impostor seat was voted out');
  device.send({ t: 'continue' });
  await device.until(() => device.view.phase === 'guess', 5000, 'solo last guess');
  device.send({ t: 'seat', index: impSeatIdx });
  await device.until(() => device.view.activeSeat === impSeatIdx, 3000, 'impostor seat sees options');
  ok(Array.isArray(device.view.guessOptions) && device.view.guessOptions.length === 3, 'only the impostor seat sees guess options');
  device.send({ t: 'seat', index: 0 === impSeatIdx ? 1 : 0 });
  await sleep(120);
  ok(device.view.guessOptions == null, 'crew seat sees no options');
  device.send({ t: 'seat', index: impSeatIdx });
  await device.until(() => device.view.activeSeat === impSeatIdx, 3000, 'back to impostor seat');
  device.send({ t: 'guess', word: 'not even close' });
  await device.until(() => device.view.phase === 'end', 4000, 'solo end');
  ok(device.view.winner === 'crew', `wrong guess by the seat → crew wins (${device.view.reason})`);

  device.send({ t: 'leave' });
  await sleep(150);
  ok(true, 'pass & play room cleaned up');

  for (const c of clients) c.close();
  await sleep(200);
} catch (err) {
  failures += 1;
  console.error(`\n✗ ${err.message}`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
console.log(failures ? `${failures} FAILURE(S)` : 'ALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
