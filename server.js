import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { WebSocketServer } from 'ws';
import * as pro from './lib/pro.js';

const __dirname = import.meta.dirname;
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 5173;

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 20;
const SOLO_MAX_SEATS = 20;
const MAX_IMPOSTORS = 3;
const MODES = ['classic', 'mysterious', 'chaotic'];
const SEAT_GRACE_MS = 45_000;
const IN_PLAY = ['reveal', 'vote', 'tally', 'guess'];

// ---------------------------------------------------------------- word banks
const CATEGORIES = {
  Animals: { difficulty: 'Easy', words: ['elephant', 'penguin', 'giraffe', 'octopus', 'kangaroo', 'dolphin', 'turtle', 'eagle', 'snake', 'rabbit', 'zebra', 'shark', 'hamster', 'panda', 'owl', 'crab', 'wolf', 'whale', 'flamingo', 'leopard'] },
  Food: { difficulty: 'Easy', words: ['pizza', 'sushi', 'burger', 'pancake', 'spaghetti', 'taco', 'donut', 'salad', 'cookie', 'sandwich', 'noodle', 'cheese', 'steak', 'waffle', 'burrito', 'croissant', 'popcorn', 'dumpling', 'lasagna', 'smoothie'] },
  Places: { difficulty: 'Easy', words: ['beach', 'library', 'airport', 'hospital', 'school', 'desert', 'island', 'castle', 'stadium', 'museum', 'forest', 'bridge', 'hotel', 'farm', 'church', 'cinema', 'harbor', 'canyon', 'playground', 'market'] },
  Jobs: { difficulty: 'Easy', words: ['doctor', 'pirate', 'teacher', 'firefighter', 'chef', 'astronaut', 'detective', 'farmer', 'lawyer', 'plumber', 'engineer', 'vet', 'soldier', 'waiter', 'photographer', 'mailman', 'scientist', 'clown', 'librarian', 'barista'] },
  Sports: { difficulty: 'Easy', words: ['soccer', 'basketball', 'tennis', 'boxing', 'swimming', 'skiing', 'golf', 'volleyball', 'cricket', 'baseball', 'surfing', 'bowling', 'hockey', 'cycling', 'archery', 'marathon', 'wrestling', 'rugby'] },
  Objects: { difficulty: 'Easy', words: ['umbrella', 'toothbrush', 'hammer', 'guitar', 'candle', 'backpack', 'mirror', 'piano', 'camera', 'key', 'ladder', 'pillow', 'clock', 'scissors', 'lantern', 'bicycle', 'kettle', 'flashlight', 'notebook', 'blanket'] },
  Cinema: { difficulty: 'Medium', words: ['sequel', 'trailer', 'premiere', 'director', 'actor', 'script', 'stunt', 'villain', 'subplot', 'cameo', 'credits', 'dubbing', 'subtitle', 'storyboard', 'remake', 'poster', 'superhero', 'animation', 'genre', 'monster'] },
  Travel: { difficulty: 'Medium', words: ['passport', 'suitcase', 'hostel', 'luggage', 'visa', 'terminal', 'taxi', 'souvenir', 'compass', 'itinerary', 'cruise', 'resort', 'camping', 'hiking', 'jetlag', 'border', 'embassy', 'guide', 'ticket', 'tourism'] },
  Nature: { difficulty: 'Medium', words: ['rainbow', 'volcano', 'waterfall', 'thunder', 'snowflake', 'tornado', 'sunflower', 'glacier', 'cactus', 'river', 'moon', 'hurricane', 'ocean', 'lightning', 'iceberg', 'forest', 'meadow', 'cliff', 'tide', 'avalanche'] },
  Tech: { difficulty: 'Medium', words: ['laptop', 'keyboard', 'router', 'screen', 'printer', 'battery', 'charger', 'camera', 'microphone', 'speaker', 'software', 'robot', 'satellite', 'drone', 'tablet', 'server', 'cable', 'sensor', 'bluetooth', 'encryption'] },
  Brands: { difficulty: 'Hard', words: ['nike', 'adidas', 'spotify', 'netflix', 'samsung', 'toyota', 'lego', 'ikea', 'starbucks', 'google', 'amazon', 'sony', 'ferrari', 'rolex', 'dell', 'pepsi', 'heinz', 'hershey', 'prada', 'paypal'] },

  // ------------------------------------------------------------ Pro packs
  // Niche topics
  Anime: { difficulty: 'Medium', tier: 'pro', words: ['shonen', 'waifu', 'filler arc', 'senpai', 'manga', 'cosplay', 'opening theme', 'tsundere', 'mecha', 'isekai', 'sub vs dub', 'training arc', 'convention', 'final boss', 'side character', 'power level', 'plot twist', 'mascot', 'recap episode', 'studio ghibli'] },
  Coding: { difficulty: 'Hard', tier: 'pro', words: ['merge conflict', 'git blame', 'stack overflow', 'regex', 'dark mode', 'unit test', 'dependency hell', 'code review', 'tabs vs spaces', 'localhost', 'hotfix', 'docker', 'cache', 'refactor', 'console log', 'api key', 'branch', 'rubber duck', 'tech debt', 'rollback'] },
  Football: { difficulty: 'Hard', tier: 'pro', words: ['offside', 'penalty shootout', 'transfer window', 'free kick', 'var', 'hat-trick', 'derby', 'red card', 'midfielder', 'own goal', 'stadium chant', 'group stage', 'extra time', 'goalkeeper', 'corner kick', 'golden boot', 'clean sheet', 'relegation', 'bicycle kick', 'away fans'] },
  'Board Games': { difficulty: 'Medium', tier: 'pro', words: ['monopoly', 'catan', 'jenga', 'scrabble', 'uno', 'dungeons and dragons', 'risk', 'cluedo', 'poker', 'backgammon', 'dominoes', 'snakes and ladders', 'codenames', 'pictionary', 'carcassonne', 'house rules', 'dice', 'meeple', 'cheating', 'rulebook'] },
  Mythology: { difficulty: 'Medium', tier: 'pro', words: ['zeus', 'medusa', 'thor', 'minotaur', 'hades', 'valhalla', 'sphinx', 'phoenix', 'kraken', 'titan', 'olympus', 'cyclops', 'valkyrie', 'temple', 'oracle', 'pegasus', 'underworld', 'sacrifice', 'prophecy', 'lightning bolt'] },
  Coffee: { difficulty: 'Medium', tier: 'pro', words: ['espresso', 'latte art', 'cold brew', 'barista', 'flat white', 'decaf', 'aeropress', 'french press', 'crema', 'macchiato', 'oat milk', 'pour over', 'grinder', 'cortado', 'tasting notes', 'chemex', 'single origin', 'third wave', 'burnt', 'milk jug'] },
  Cocktails: { difficulty: 'Medium', tier: 'pro', words: ['mojito', 'negroni', 'margarita', 'old fashioned', 'aperol spritz', 'daiquiri', 'moscow mule', 'pina colada', 'garnish', 'shaker', 'mocktail', 'hangover', 'happy hour', 'ice cube', 'last call', 'shot glass', 'cocktail umbrella', 'bar tab', 'bitters', 'twist'] },
  Gaming: { difficulty: 'Easy', tier: 'pro', words: ['speedrun', 'loot box', 'npc', 'boss fight', 'respawn', 'checkpoint', 'easter egg', 'open world', 'lag', 'controller', 'microtransaction', 'tutorial level', 'glitch', 'achievement', 'steam sale', 'clan', 'final save', 'secret ending', 'rage quit', 'difficulty spike'] },
  Space: { difficulty: 'Medium', tier: 'pro', words: ['black hole', 'rocket launch', 'astronaut', 'satellite', 'mars rover', 'light year', 'orbit', 'space station', 'meteor shower', 'gravity', 'telescope', 'solar flare', 'nebula', 'comet', 'spacewalk', 'mission control', 'vacuum', 're-entry', 'launch pad', 'countdown'] },

  // Fun topics
  Memes: { difficulty: 'Easy', tier: 'pro', words: ['cursed image', 'rickroll', 'deep fried', 'nobody asked', 'this is fine', 'stonks', 'epic fail', 'copypasta', 'doggo', 'touch grass', 'ratio', 'based', 'ok boomer', 'main character', 'group chat', 'viral', 'screenshot', 'caption', 'fandom', 'algorithm'] },
  Conspiracies: { difficulty: 'Medium', tier: 'pro', words: ['flat earth', 'area 51', 'bigfoot', 'loch ness', 'moon landing', 'illuminati', 'chemtrails', 'time traveler', 'simulation theory', 'bermuda triangle', 'crop circles', 'lizard people', 'secret bunker', 'mandela effect', 'aliens', 'tinfoil hat', 'classified file', 'eyewitness', 'red string', 'government cover-up'] },
  'Awkward Moments': { difficulty: 'Easy', tier: 'pro', words: ['holding a door', 'wrong name', 'toast gone wrong', 'reply all', 'dead silence', 'wave at stranger', 'food in teeth', 'mic left on', 'wrong chat', 'loud ringtone', 'tripping upstairs', 'forgotten birthday', 'saying you too', 'split bill', 'elevator small talk', 'laughing alone', 'unread message', 'sweaty handshake', 'mum joke', 'cheek kiss'] },
  'Reality TV': { difficulty: 'Medium', tier: 'pro', words: ['the villa', 'plot twist', 'coupling', 'recoupling', 'confessional', 'drama', 'villain edit', 'finale', 'bombshell', 'backstab', 'challenge', 'public vote', 'reunion', 'meltdown', 'cheating scandal', 'host', 'couple', 'duvet', 'walkout', 'screen time'] },
  Horror: { difficulty: 'Easy', tier: 'pro', words: ['haunted house', 'jump scare', 'final girl', 'ghost', 'slasher', 'seance', 'possessed doll', 'creepy basement', 'blood moon', 'vampire', 'zombie', 'curse', 'mirror', 'whisper', 'footsteps', 'fog', 'cursed video', 'three knocks', 'abandoned hospital', 'monster'] },
  Emojis: { difficulty: 'Medium', tier: 'pro', words: ['skull', 'nails', 'clown', 'ghost', 'shrug', 'pray', 'side eye', 'fire', 'dumpster', 'melting face', 'eggplant', 'eye roll', 'sparkle', 'chefs kiss', 'prayer circle', 'sticker', 'thumbs up', 'crying laugh', 'heart hands', 'blushing'] },
  'Internet Slang': { difficulty: 'Easy', tier: 'pro', words: ['ghosted', 'doomscrolling', 'lurker', 'simp', 'delulu', 'rizz', 'slay', 'copium', 'sus', 'mid', 'glow up', 'receipts', 'sub tweet', 'rent free', 'brain rot', 'thread', 'dm', 'unfollow', 'spam', 'vibe check'] },
  'Bad Habits': { difficulty: 'Easy', tier: 'pro', words: ['nail biting', 'snooze button', 'late night snack', 'skipping breakfast', 'unread emails', 'phone in bed', 'junk drawer', 'procrastinating', 'biting pen', 'cracking knuckles', 'drunk texting', 'binge watching', 'impulse buy', 'saving tabs', 'third coffee', 'lying about water', 'hair twirl', 'doom scroll', 'messy desk', 'never flossing'] },
  'Office Life': { difficulty: 'Easy', tier: 'pro', words: ['reply all', 'stand-up', 'calendar invite', 'meeting that could be an email', 'desk plant', 'coffee run', 'water cooler', 'microwave smell', 'last slice', 'printer jam', 'badge', 'open plan', 'elevator pitch', 'handover', 'zoom background', 'mute button', 'out of office', 'hot desk', 'appraisal', 'mandatory fun'] },
};
const CAT_KEYS = Object.keys(CATEGORIES);
const packTier = (k) => (CATEGORIES[k].tier === 'pro' ? 'pro' : 'free');
const FREE_KEYS = CAT_KEYS.filter((k) => packTier(k) === 'free');
const PRO_KEYS = CAT_KEYS.filter((k) => packTier(k) === 'pro');
const DEFAULT_SETTINGS = {
  category: 'mixed',
  mode: 'mysterious',
  impostors: 'auto',        // 'auto' | 1 | 2 | 3
  lastGuess: true,          // impostor steal rule
  maxPlayers: MAX_PLAYERS,
};

function lanAddress() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return null;
}
const LAN = lanAddress();

// --------------------------------------------------------------------- utils
const rooms = new Map();

function genCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += alphabet[crypto.randomInt(alphabet.length)];
    if (!rooms.has(code)) return code;
  }
}
const uid = () => crypto.randomBytes(6).toString('hex');
const pick = (arr) => arr[crypto.randomInt(arr.length)];
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function send(player, msg) {
  if (player && player.ws && player.ws.readyState === 1) player.ws.send(JSON.stringify(msg));
}
const connected = (room) => room.players.filter((p) => p.connected);
const alivePlayers = (room) => room.players.filter((p) => p.alive && (room.solo || p.connected));
const byId = (room, id) => room.players.find((p) => p.id === id) || null;
const activeSeat = (room) => room.players[room.activeSeat] || room.players[0] || null;function setPhase(room, phase) {
  room.phase = phase;
  broadcast(room);
}

function settingsView(room) {
  const s = room.settings;
  return {
    category: s.category, mode: s.mode, impostors: s.impostors,
    lastGuess: s.lastGuess, maxPlayers: s.maxPlayers,
  };
}

// ------------------------------------------------------------------- pro tier
// The host's subscription unlocks the Pro packs for the whole room.
function roomOwner(room) {
  return room.solo ? room.device : byId(room, room.hostId);
}
function roomPro(room) {
  return pro.status(room.proKey).active;
}
function allowedPacks(room) {
  const keys = roomPro(room) ? CAT_KEYS : FREE_KEYS;
  return room.customWords.length >= 5 ? keys.concat('custom') : keys;
}

function categoryList(room) {
  const unlocked = roomPro(room);
  const list = CAT_KEYS.map((k) => ({
    key: k,
    difficulty: CATEGORIES[k].difficulty,
    count: CATEGORIES[k].words.length,
    tier: packTier(k),
    locked: packTier(k) === 'pro' && !unlocked,
  }));
  if (room.customWords.length >= 5) list.push({ key: 'custom', difficulty: 'Custom', count: room.customWords.length, tier: 'free', locked: false });
  return list;
}

function setProKey(player, msg) {
  const key = pro.normalizeKey(msg.key);
  if (!key) return send(player, { t: 'error', msg: 'That does not look like a Pro key.' });
  const room = player.room;
  if (room && !isHost(player)) {
    return send(player, { t: 'error', msg: 'Only the host can unlock Pro for this room.' });
  }
  const state = pro.status(key);
  if (!state.active) {
    const why = state.status === 'pending'
      ? 'That key is still waiting for the payment to clear — try again in a minute.'
      : 'That Pro key is not active. Check the code or resubscribe.';
    return send(player, { t: 'error', msg: why });
  }
  player.proKey = key;
  if (room) room.proKey = key;
  if (room) broadcast(room);
  else send(player, { t: 'pro', active: true, key });
}

// --------------------------------------------------------------- game setup
function wordsFor(room, catKey) {
  if (catKey === 'custom') return room.customWords;
  return CATEGORIES[catKey] ? CATEGORIES[catKey].words : CATEGORIES.Animals.words;
}

function chooseCategory(room) {
  const want = room.settings.category;
  const keys = allowedPacks(room);
  if (want === 'custom' && room.customWords.length >= 5) return 'custom';
  if (want === 'mixed' || !keys.includes(want)) return pick(keys);
  return want;
}

function impostorCountFor(room, n) {
  const cap = Math.max(1, Math.min(MAX_IMPOSTORS, Math.floor(n / 2)));
  const setting = room.settings.impostors;
  if (setting === 'chaotic' || room.settings.mode === 'chaotic') return 1 + crypto.randomInt(cap);
  if (setting === 'auto') {
    if (n >= 10) return Math.min(cap, 3);
    if (n >= 6) return Math.min(cap, 2);
    return 1;
  }
  return Math.max(1, Math.min(cap, Number(setting) || 1));
}

function deal(room) {
  const players = room.solo ? room.players : connected(room);
  if (players.length < MIN_PLAYERS) return;

  const catKey = chooseCategory(room);
  const words = wordsFor(room, catKey);
  const word = pick(words);
  const impostorCount = impostorCountFor(room, players.length);
  const seats = shuffle(players);
  const impostors = seats.slice(0, impostorCount);

  for (const p of room.players) {
    p.isImpostor = false;
    p.alive = true;
    p.ready = false;
    p.voted = null;
    p.word = null;
    p.category = catKey;
  }
  for (const p of players) p.word = word; // crew share the real word
  for (const imp of impostors) {
    imp.isImpostor = true;
    imp.word = room.settings.mode === 'classic'
      ? null
      : (words.filter((w) => w !== word).length ? pick(words.filter((w) => w !== word)) : word);
  }

  room.round = {
    word,
    category: catKey,
    mode: room.settings.mode,
    impostorCount,
    order: seats.map((p) => p.id),
  };
  room.clues = [];
  room.votes = {};
  room.eliminated = [];
  room.winner = null;
  room.reason = null;
  room.guessOptions = null;
  room.turn = 0;
  room.activeSeat = 0;
  setPhase(room, 'reveal');
}

// ------------------------------------------------- discussion -> voting (no typed clues)
// Clue phase removed: players discuss out loud, then vote.
function startPass(room) {
  room.clues = [];
  room.passOrder = null;
  room.turn = 0;
  const alive = (room.solo ? room.players : connected(room)).filter((p) => p.alive);
  if (!alive.length) return endGame(room, 'crew', 'Everyone left the table.');
  return openVoting(room);
}

function currentTurn(room) {
  return null;
}

function submitClue(room, actor) {
  return send(room.device || actor, { t: 'error', msg: 'Typed clues are off — discuss together instead.' });
}

// ----------------------------------------------------------- voting & reveal
function openVoting(room) {
  for (const p of room.players) p.voted = null;
  room.votes = {};
  setPhase(room, 'vote');
}

function vote(room, actor, raw) {
  if (room.phase !== 'vote') return sendError(room, actor, 'Voting is not open.');
  if (!actor.alive) return sendError(room, actor, 'You have been eliminated — no voting.');
  if (actor.voted) return sendError(room, actor, 'You already voted.');
  const target = raw === 'skip' ? 'skip' : raw;
  if (target !== 'skip') {
    const t = byId(room, target);
    if (!t || !t.alive || t.id === actor.id) return sendError(room, actor, 'You cannot vote for that player.');
  }
  actor.voted = target;
  room.votes[target] = (room.votes[target] || 0) + 1;
  const voters = room.solo ? room.players.filter((p) => p.alive) : connected(room).filter((p) => p.alive);
  if (voters.every((p) => p.voted)) tally(room);
  else broadcast(room);
}

function tally(room) {
  const counts = { ...room.votes };
  let top = null;
  let topCount = 0;
  let tie = false;
  for (const p of alivePlayers(room)) {
    const c = counts[p.id] || 0;
    if (c > topCount) { top = p; topCount = c; tie = false; }
    else if (c === topCount && c > 0) tie = true;
  }
  room.eliminatedNow = null;
  if (top && topCount > 0 && !tie) {
    top.alive = false;
    room.eliminatedNow = { id: top.id, name: top.name, isImpostor: top.isImpostor, votes: topCount };
    room.eliminated.push(room.eliminatedNow);
  }
  setPhase(room, 'tally');
}

function resolveTally(room) {
  const imps = alivePlayers(room).filter((p) => p.isImpostor);
  const crew = alivePlayers(room).filter((p) => !p.isImpostor);
  const lastOut = room.eliminatedNow;

  if (!imps.length) {
    const outImp = [...room.eliminated].reverse().find((e) => e.isImpostor);
    if (room.settings.lastGuess && outImp) {
      const player = byId(room, outImp.id);
      if (player) return beginGuess(room, player);
    }
    return endGame(room, 'crew', 'Every impostor was voted out.');
  }
  if (imps.length >= crew.length) return endGame(room, 'imp', 'The impostors have taken over.');
  openVoting(room);
}

function beginGuess(room, impostor) {
  const word = room.round.word;
  const decoys = shuffle(wordsFor(room, room.round.category).filter((w) => w !== word)).slice(0, 2);
  room.guessFor = impostor.id;
  room.guessOptions = shuffle([word, ...decoys]);
  setPhase(room, 'guess');
}

function endGame(room, winner, reason) {
  room.winner = winner;
  room.reason = reason;
  for (const p of room.players) {
    const won = winner === 'crew' ? !p.isImpostor : p.isImpostor;
    if (won) p.wins = (p.wins || 0) + 1;
  }
  setPhase(room, 'end');
}

// ------------------------------------------------------------------- views
function viewFor(room, subject) {
  const showReveal = room.phase === 'end';
  const showVotes = ['tally', 'guess', 'end'].includes(room.phase);
  const voteCounts = showVotes ? { ...room.votes } : null;
  const isHost = (p) => p && room.hostId === p.id;

  return {
    t: 'room',
    code: room.code,
    joinUrl: LAN ? `http://${LAN}:${PORT}` : null,
    phase: room.phase,
    hostId: room.hostId,
    me: subject ? subject.id : null,
    solo: room.solo,
    activeSeat: room.solo ? room.activeSeat : null,
    seatCount: room.solo ? room.players.length : null,
    settings: settingsView(room),
    categories: categoryList(room),
    modes: MODES,
    limits: { min: MIN_PLAYERS, max: MAX_PLAYERS, soloMax: SOLO_MAX_SEATS },
    pro: {
      active: roomPro(room),
      key: subject && (isHost(subject) || (room.solo && subject === room.device)) ? room.proKey : null,
      name: pro.PRO.name,
      blurb: pro.PRO.blurb,
      priceLabel: pro.PRO.priceLabel,
      priceCents: pro.PRO.priceCents,
      period: pro.PRO.period,
      packs: PRO_KEYS.length,
      configured: pro.stripeConfigured(),
    },
    winner: room.winner,
    reason: room.reason,
    yourWord: subject ? subject.word : null,
    yourCategory: subject ? subject.category : null,
    youAreImpostor: subject ? !!subject.isImpostor : false,
    yourAlive: subject ? subject.alive !== false : true,
    yourWins: subject ? (subject.wins || 0) : 0,
    myVote: subject ? subject.voted : null,
    ready: subject ? !!subject.ready : false,
    turnId: currentTurn(room) ? currentTurn(room).id : null,
    clues: room.clues,
    eliminated: room.eliminated,
    eliminatedNow: showVotes ? room.eliminatedNow || null : null,
    voteCounts,
    guessOptions: room.phase === 'guess' && subject && subject.id === room.guessFor ? room.guessOptions : null,
    guessWaiting: room.phase === 'guess' && subject && subject.id !== room.guessFor,
    roundWord: showReveal && room.round ? room.round.word : null,
    roundCategory: room.round ? room.round.category : null,
    roundMode: room.round ? room.round.mode : null,
    impostorCount: showReveal && room.round ? room.round.impostorCount : null,
    chat: room.solo ? [] : room.chat,
    isHost: room.solo ? true : isHost(subject),
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: room.solo ? true : p.connected,
      host: p.id === room.hostId,
      ready: !!p.ready,
      voted: showVotes ? false : Boolean(p.voted),
      alive: p.alive !== false,
      wins: p.wins || 0,
      impostor: showReveal ? !!p.isImpostor : false,
    })),
  };
}

// A selected Pro pack the room can no longer use falls back to Mixed, so a
// lapsed subscription never leaves a locked pack showing as selected.
function normalizeCategory(room) {
  const s = room.settings;
  if (!PRO_KEYS.includes(s.category)) return;
  if (!roomPro(room)) s.category = 'mixed';
}

function broadcast(room) {
  normalizeCategory(room);
  if (room.solo) {
    send(room.device, viewFor(room, activeSeat(room)));
    return;
  }
  for (const p of room.players) if (p.connected) send(p, viewFor(room, p));
}

const sendError = (room, actor, msg) => send(room.device || actor, { t: 'error', msg });

// --------------------------------------------------------------------- http
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------- pro API
// The public origin used for Stripe redirects. APP_ORIGIN wins when set; the
// browser's Origin header is safe to echo because it only shapes a redirect.
function publicOrigin(req) {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, '');
  const origin = req.headers.origin;
  if (origin && /^https?:\/\/[^\s]+$/.test(origin)) return origin.replace(/\/$/, '');
  const host = req.headers.host;
  if (host && /^[a-z0-9.\-:]+$/i.test(host)) {
    // Hosts like Render terminate TLS in front of us, so the socket is plain http.
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    return `${proto === 'https' ? 'https' : 'http'}://${host}`;
  }
  return `http://localhost:${PORT}`;
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > limit) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const json = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === '/api/pro/status' && req.method === 'GET') {
    let st = pro.status(url.searchParams.get('key'));
    // Just back from Stripe? Confirm the payment with Stripe directly, so Pro
    // unlocks even when no webhook endpoint is configured.
    if (!st.active && (await pro.confirmPending(url.searchParams.get('key')))) {
      st = pro.status(url.searchParams.get('key'));
    }
    return json(200, {
      active: st.active,
      status: st.status,
      until: st.until,
      plan: pro.PRO,
      packs: PRO_KEYS.length,
      configured: pro.stripeConfigured(),
    });
  }

  if (url.pathname === '/api/pro/checkout' && req.method === 'POST') {
    if (!pro.stripeConfigured()) {
      return json(503, {
        error: 'payments_not_configured',
        message: 'Pro checkout is not set up on this server yet.',
      });
    }
    const key = pro.mintKey();
    try {
      const session = await pro.createCheckout({ origin: publicOrigin(req), key });
      pro.addPending(key, { sessionId: session.id });
      return json(200, { url: session.url, key });
    } catch (err) {
      console.error('checkout failed:', err.message);
      return json(502, { error: 'checkout_failed', message: 'Could not start checkout. Try again.' });
    }
  }

  if (url.pathname === '/api/stripe/webhook' && req.method === 'POST') {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return json(503, { error: 'webhook_not_configured' });
    const raw = await readBody(req);
    if (!pro.verifyStripeSignature(raw, req.headers['stripe-signature'], secret)) {
      return json(400, { error: 'bad_signature' });
    }
    let event = null;
    try { event = JSON.parse(raw); } catch { return json(400, { error: 'bad_json' }); }
    try { pro.handleStripeEvent(event); } catch (err) { console.error('webhook apply failed:', err); }
    return json(200, { received: true });
  }

  return json(404, { error: 'not_found' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
  }
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((err) => {
      console.error('api error', err);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'server_error' }));
    });
    return;
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    const headers = { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' };
    if (filePath.endsWith('sw.js') || filePath.endsWith('app.js') || filePath.endsWith('index.html')) headers['cache-control'] = 'no-cache';
    res.writeHead(200, headers);
    res.end(data);
  });
});

// --------------------------------------------------------------- websocket
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  const player = {
    id: uid(), name: '', ws, connected: true, room: null, isDevice: false,
    isImpostor: false, word: null, alive: true, voted: null, ready: false, wins: 0,
  };
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    try {
      handle(msg, player);
    } catch (err) {
      console.error('handler error', err);
      send(player, { t: 'error', msg: 'Something went wrong.' });
    }
  });
  ws.on('close', () => (player.isDevice ? dropSoloRoom(player) : detach(player)));
  ws.on('error', () => {});
});

function handle(msg, player) {
  const room = player.room;
  // in Pass & Play the device acts on behalf of the seat it is handing the phone to
  const actor = room && room.solo ? activeSeat(room) : null;

  switch (msg.t) {
    case 'create': return createRoom(player, msg);
    case 'join': return joinRoom(player, msg);
    case 'settings': return updateSettings(player, msg);
    case 'seats': return updateSeats(player, msg);
    case 'start': return startRound(player, msg);
    case 'ready': return ready(actor || player);
    case 'clue': return room && actor ? submitClue(room, actor, msg.word) : (room ? submitClue(room, player, msg.word) : null);
    case 'vote': return room && actor ? vote(room, actor, msg.target) : (room ? vote(room, player, msg.target) : null);
    case 'guess': return room && actor ? guess(room, actor, msg.word) : (room ? guess(room, player, msg.word) : null);
    case 'continue': return continueAfterTally(player);
    case 'advance': return advancePhase(player);
    case 'again': return again(player);
    case 'chat': return chat(player, msg);
    case 'kick': return kick(player, msg);
    case 'transfer': return transfer(player, msg);
    case 'seat': return switchSeat(player, msg);
    case 'leave': return player.isDevice ? dropSoloRoom(player) : removePlayer(player);
    case 'pro': return setProKey(player, msg);
    case 'ping': return send(player, { t: 'pong' });
  }
}

// A returning host re-sends their saved key; only an active one is kept.
function applyProKey(player, room, raw) {
  if (!pro.status(raw).active) return;
  player.proKey = pro.normalizeKey(raw);
  if (room && isHost(player) && !room.proKey) room.proKey = player.proKey;
}

function cleanName(raw) {
  const name = String(raw || '').trim().slice(0, 16);
  return name || 'Player';
}
function uniqueName(room, base) {
  const taken = new Set(room.players.map((p) => p.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 50; i++) {
    const n = `${base.slice(0, 12)} ${i}`;
    if (!taken.has(n.toLowerCase())) return n;
  }
  return `${base.slice(0, 10)} ${uid().slice(0, 2)}`;
}

function newRoom(host) {
  const code = genCode();
  const room = {
    code,
    hostId: host.id,
    solo: false,
    device: null,
    phase: 'lobby',
    players: [host],
    settings: { ...DEFAULT_SETTINGS },
    customWords: [],
    chat: [],
    proKey: null,
    winner: null,
    reason: null,
    round: null,
    clues: [],
    votes: {},
    eliminated: [],
    eliminatedNow: null,
    guessOptions: null,
    guessFor: null,
    passOrder: null,
    turn: 0,
    activeSeat: 0,
  };
  rooms.set(code, room);
  return room;
}

function createRoom(player, msg) {
  if (player.room) player.isDevice ? dropSoloRoom(player) : removePlayer(player);
  const room = newRoom(player);
  if (msg.solo) {
    room.solo = true;
    room.device = player;
    player.isDevice = true;
    room.players = [];
  }
  player.room = room;
  player.name = uniqueName(room, cleanName(msg.name));
  player.connected = true;
  applyProKey(player, room, msg.proKey);
  send(player, { t: 'you', id: player.id, code: room.code });
  broadcast(room);
}

function joinRoom(player, msg) {
  const code = String(msg.code || '').trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) return send(player, { t: 'error', msg: 'No room with that code.' });

  const existing = msg.resume ? room.players.find((p) => p.id === msg.resume) : null;
  if (existing && existing !== player && !room.solo) {
    if (existing.connected && existing.ws && existing.ws.readyState === 1) {
      return send(player, { t: 'error', msg: 'That seat is live in another tab — close it or join as a new player.' });
    }
    const oldWs = existing.ws;
    clearTimeout(existing.reapTimer);
    existing.reapTimer = null;
    existing.ws = player.ws;
    existing.connected = true;
    if (oldWs && oldWs !== player.ws) {
      oldWs.removeAllListeners();
      try { oldWs.close(); } catch { /* ignore */ }
    }
    Object.assign(player, existing);
    room.players = room.players.filter((p) => p !== existing).concat(player);
    player.room = room;
    player.connected = true;
    applyProKey(player, room, msg.proKey);
    send(player, { t: 'you', id: player.id, code });
    broadcast(room);
    return;
  }

  if (room.solo) return send(player, { t: 'error', msg: 'That room is a Pass & Play game on one device.' });
  if (connected(room).length >= Number(room.settings.maxPlayers)) {
    return send(player, { t: 'error', msg: 'That room is full.' });
  }
  if (['reveal', 'vote'].includes(room.phase)) {
    return send(player, { t: 'error', msg: 'A round is in progress — try again after.' });
  }
  if (player.room) removePlayer(player);
  player.room = room;
  player.name = uniqueName(room, cleanName(msg.name));
  player.connected = true;
  applyProKey(player, room, msg.proKey);
  room.players.push(player);
  pushChat(room, null, `${player.name} joined the room`);
  send(player, { t: 'you', id: player.id, code });
  broadcast(room);
}

// ------------------------------------------------------------- host actions
function isHost(player) {
  return player.room && player.room.hostId === player.id;
}

function updateSettings(player, msg) {
  const room = player.room;
  if (!room || !isHost(player) || room.phase !== 'lobby') {
    return send(player, { t: 'error', msg: 'Only the host can change the settings.' });
  }
  const s = room.settings;
  if (MODES.includes(msg.mode)) s.mode = msg.mode;
  if (msg.category === 'custom') {
    if (room.customWords.length >= 5) s.category = 'custom';
  } else if (msg.category === 'mixed' || FREE_KEYS.includes(msg.category)) {
    s.category = msg.category;
  } else if (PRO_KEYS.includes(msg.category)) {
    if (!roomPro(room)) return send(player, { t: 'error', msg: `“${msg.category}” is a Pro pack — unlock Pro to play it.` });
    s.category = msg.category;
  }
  if (['auto', 1, 2, 3].includes(msg.impostors) || ['1', '2', '3'].includes(String(msg.impostors))) {
    s.impostors = msg.impostors === 'auto' ? 'auto' : Math.max(1, Math.min(3, Number(msg.impostors)));
  }
  if (typeof msg.lastGuess === 'boolean') s.lastGuess = msg.lastGuess;
  if (Number(msg.maxPlayers) >= MIN_PLAYERS && Number(msg.maxPlayers) <= MAX_PLAYERS) s.maxPlayers = Number(msg.maxPlayers);

  if (typeof msg.customWords === 'string') {
    const words = msg.customWords.split(/[,\n]/).map((w) => w.trim()).filter(Boolean).slice(0, 60);
    room.customWords = [...new Set(words.map((w) => w.slice(0, 24).toLowerCase()))].slice(0, 60);
  }
  broadcast(room);
}

function updateSeats(player, msg) {
  const room = player.room;
  if (!room || !isHost(player) || room.phase !== 'lobby') return;
  if (!room.solo) {
    room.solo = true;
    room.device = player;
    player.isDevice = true;
    room.players = [];
    room.hostId = null;
  }
  const names = (Array.isArray(msg.names) ? msg.names : []).map(cleanName).slice(0, SOLO_MAX_SEATS);
  if (names.length < MIN_PLAYERS) return send(player, { t: 'error', msg: `Pass & Play needs at least ${MIN_PLAYERS} players.` });
  const wins = new Map(room.players.map((p) => [p.name, p.wins || 0]));
  const seats = [];
  for (const name of names) {
    seats.push({
      id: uid(), name: uniqueName({ players: seats }, name), ws: null, connected: true,
      isSeat: true, isImpostor: false, alive: true, voted: null, ready: false,
      wins: wins.get(name) || 0, room: null,
    });
  }
  for (const seat of seats) seat.room = room;
  room.players = seats;
  room.hostId = player.id; // the device is the host in Pass & Play
  room.activeSeat = 0;
  broadcast(room);
}

function switchSeat(player, msg) {
  const room = player.room;
  if (!room || !room.solo || !player.isDevice) return;
  const idx = Number(msg.index);
  if (!(idx >= 0 && idx < room.players.length)) return;
  room.activeSeat = idx;
  broadcast(room);
}

function startRound(player, msg) {
  const room = player.room;
  if (!room || !isHost(player)) return;
  if (!['lobby', 'end'].includes(room.phase)) return;
  if (room.phase === 'end') return again(player);
  const count = room.solo ? room.players.length : connected(room).length;
  const need = msg && msg.force ? 2 : MIN_PLAYERS;
  if (count < need) return send(player, { t: 'error', msg: `Need at least ${need} players to start.` });
  deal(room);
}

function ready(player) {
  const room = player.room;
  if (!room || room.phase !== 'reveal' || !player) return;
  player.ready = true;
  const pool = room.solo ? room.players : connected(room);
  if (pool.every((p) => p.ready)) startPass(room);
  else broadcast(room);
}

function continueAfterTally(player) {
  const room = player.room;
  if (!room || room.phase !== 'tally') return;
  if (room.solo || isHost(player)) resolveTally(room);
}

function advancePhase(player) {
  const room = player.room;
  if (!room || !isHost(player)) return;
  if (room.phase === 'vote') tally(room);
}

function guess(room, actor, word) {
  if (room.phase !== 'guess' || !actor || actor.id !== room.guessFor) return;
  const correct = String(word || '').toLowerCase() === String(room.round.word).toLowerCase();
  endGame(room, correct ? 'imp' : 'crew',
    correct ? 'The impostor guessed the word and stole the win!' : 'The impostor guessed wrong.');
}

function again(player) {
  const room = player.room;
  if (!room || !isHost(player) || room.phase !== 'end') return;
  room.phase = 'lobby';
  room.clues = [];
  room.votes = {};
  room.eliminated = [];
  room.eliminatedNow = null;
  room.round = null;
  room.winner = null;
  room.reason = null;
  room.guessOptions = null;
  room.guessFor = null;
  room.passOrder = null;
  room.turn = 0;
  room.activeSeat = 0;
  for (const p of room.players) {
    p.isImpostor = false;
    p.word = null;
    p.voted = null;
    p.ready = false;
    p.alive = true;
  }
  broadcast(room);
}

function kick(player, msg) {
  const room = player.room;
  if (!room || !isHost(player)) return;
  const target = byId(room, msg.id);
  if (!target || target.id === player.id) return;
  pushChat(room, null, `${target.name} was removed by the host`);
  removePlayer(target, true);
  send(target, { t: 'error', msg: 'You were removed from the room.' });
}

function transfer(player, msg) {
  const room = player.room;
  if (!room || !isHost(player) || room.solo) return;
  const target = byId(room, msg.id);
  if (!target || !target.connected) return;
  room.hostId = target.id;
  broadcast(room);
}

// ------------------------------------------------------------------- chat
function pushChat(room, player, text) {
  const clean = String(text || '').trim().slice(0, 160);
  if (!clean || room.solo) return;
  room.chat.push({ from: player ? player.name : 'system', id: player ? player.id : null, text: clean, at: Date.now() });
  if (room.chat.length > 60) room.chat.splice(0, room.chat.length - 60);
}

function chat(player, msg) {
  const room = player.room;
  if (!room || room.solo) return;
  if (!['lobby', 'vote', 'end', 'tally'].includes(room.phase)) {
    return send(player, { t: 'error', msg: 'Chat is open in the lobby, while voting, and after the round.' });
  }
  pushChat(room, player, msg.text);
  broadcast(room);
}

// -------------------------------------------------------------- connections
function detach(player) {
  const room = player.room;
  player.connected = false;
  if (!room) return;
  clearTimeout(player.reapTimer);
  player.reapTimer = setTimeout(() => removePlayer(player), SEAT_GRACE_MS);
  broadcast(room);
}

function removePlayer(player, silent) {
  const room = player.room;
  clearTimeout(player.reapTimer);
  player.reapTimer = null;
  player.connected = false;
  if (!room) return;
  if (!room.players.includes(player)) { player.room = null; return; }

  room.players = room.players.filter((p) => p !== player);
  player.room = null;

  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === player.id) {
    const next = room.players.find((p) => p.connected) || room.players[0];
    if (next) room.hostId = next.id;
  }
  if (!silent) pushChat(room, null, `${player.name} left`);

  if (IN_PLAY.includes(room.phase)) {
    player.alive = false;
    if (player.isImpostor && room.phase !== 'end') {
      endGame(room, 'crew', 'An impostor disconnected.');
      return;
    }
    if (room.players.filter((p) => p.alive).length < MIN_PLAYERS) {
      endGame(room, 'crew', 'Not enough players left.');
      return;
    }
    if (room.phase === 'reveal') {
      if ((room.solo ? room.players : connected(room)).every((p) => p.ready)) startPass(room);
    } else if (room.phase === 'vote') {
      const voters = (room.solo ? room.players : connected(room)).filter((p) => p.alive);
      if (voters.every((p) => p.voted)) tally(room);
    }
  }
  broadcast(room);
}

function dropSoloRoom(player) {
  const room = player.room;
  player.connected = false;
  player.isDevice = false;
  player.room = null;
  if (!room || !room.solo) return;
  rooms.delete(room.code);
}

server.listen(PORT, () => {
  console.log(`Imposter game listening on http://localhost:${PORT}`);
});
