# 🕵️ IMPOSTER

A real-time, multiplayer **word party game** for 3–20 players — the impostor game,
now a installable PWA.

Everyone gets the **same secret word**… except one or more players, who secretly
get a **different word from the same category**. Discuss together, argue about
who doesn't belong, and vote them out. If an impostor survives the vote, they get
one guess at the real word to steal the win.

## Run it

```bash
npm install   # just the `ws` WebSocket library — Pro needs no extra packages
npm start     # serves the game on http://localhost:5173
```

Then open `http://localhost:5173`. Two ways to play:

- **Multi-device** — create a room, share the **4-letter room code**. Friends on
  the same Wi-Fi open the LAN address shown in the lobby (e.g. `http://10.200.34.43:5173`)
  and enter the code.
- **Pass & Play** — one phone passed around the table. Add 3–20 names; the game
  hands the device to each player in turn ("look away" screens between turns).

```bash
npm test      # end-to-end test: plays full rounds over real WebSockets
```

Set `PORT` to serve on a different port.

## Round flow

1. **Deal** — crew all get the same word; each impostor gets a different one from
   the same category (press & hold to peek at your card).
2. **Discuss** — talk it out in person (or in chat).
3. **Vote** — one vote each (the host can close voting early). Chat stays open
   while you decide. Most votes is eliminated;
   ties and skips mean nobody is.
4. **Last guess** *(house rule, on by default)* — an impostor who is voted out gets
   one shot at the real word. Correct guess steals the win.
5. **Reveal & score** — roles, the word, and a running scoreboard. Play again keeps
   the room together.

## Host controls & settings

Game mode (**Classic** — impostor knows nothing, **Mysterious** — impostor gets a
similar decoy word, **Chaotic** — impostor count is random and hidden), category
(including a host-supplied **custom word list**), impostor count,
last-guess rule, and room size (6/12/20). The host
can also kick players, transfer host, and force-start with fewer players.

## Pro tier — $9.90/month

The base game ships 11 free packs. **Pro** adds 18 more — nine niche topics
(Anime, Coding, Football, Board Games, Mythology, Coffee, Cocktails, Gaming,
Space) and nine silly ones (Memes, Conspiracies, Awkward Moments, Reality TV,
Horror, Emojis, Internet Slang, Bad Habits, Office Life). A Pro host's
subscription unlocks the packs for **everyone in their room**, and "Mixed"
deals from all 29 packs.

Locking is enforced on the server, not in the browser: a room without an active
subscription is refused when it selects a Pro pack, and any pack that becomes
locked again (cancelled subscription) falls back to Mixed.

### Turning payments on (about 5 minutes)

1. `cp .env.example .env` and paste your Stripe **secret key** into `STRIPE_SECRET_KEY`
   (`sk_test_…` to rehearse, `sk_live_…` for real money). `.env` is git-ignored.
2. `npm run stripe:setup` — creates the **$9.90/month** product + price in your
   Stripe account and prints `STRIPE_PRICE_ID=price_…` to add to `.env`.
3. In Stripe → Developers → Webhooks → **Add endpoint**:
   `https://<your-host>/api/stripe/webhook` with the events
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed`. Paste its signing secret into
   `STRIPE_WEBHOOK_SECRET`.
4. Set `APP_ORIGIN` to that same public URL.
5. `npm start`, then `npm run stripe:check` — it checks the key, the price amount,
   the webhook secret and that the running server sees them all.

Rehearse locally without a public URL:

```bash
stripe listen --forward-to localhost:5173/api/stripe/webhook   # prints a whsec_… for .env
# pay with 4242 4242 4242 4242, any future expiry, any CVC
```

```bash
STRIPE_SECRET_KEY=sk_test_…   # secret key
STRIPE_PRICE_ID=price_…       # $9.90/month recurring price (from stripe:setup)
STRIPE_WEBHOOK_SECRET=whsec_… # /api/stripe/webhook signing secret
APP_ORIGIN=https://…          # public origin for Stripe redirects
```

Flow: the host presses **Get Pro** → `POST /api/pro/checkout` opens Stripe
Checkout → Stripe redirects back to `/?pro=IMP-…` → the webhook activates the key
and the app unlocks the packs. Purchases are stored in `data/pro.json`
(git-ignored, mode 600) and re-checked on every deal.

Without the Stripe variables the game still runs — the paywall just says checkout
is not configured and you can hand out keys yourself:

```bash
PRO_KEYS=IMP-AAAA-BBBB-CCCC,IMP-DDDD-EEEE-FFFF   # always-active comped keys
```

Players redeem a key under **Get Pro → I already subscribed**. Keys are kept in
`localStorage` on the buying device; they are never shown to other players.

Hand out or revoke keys yourself (comps, refunds, support):

```bash
node scripts/pro-key.mjs new --email friend@example.com   # mint an active key
node scripts/pro-key.mjs list
node scripts/pro-key.mjs revoke IMP-AAAA-BBBB-CCCC
```

## Layout

- [server.js](server.js) — HTTP + WebSocket server, rooms, and the game state machine
  (all secrets stay server-side)
- [public/index.html](public/index.html), [public/app.js](public/app.js),
  [public/style.css](public/style.css) — the responsive client (light theme, 48px
  touch targets, screen-reader announcements)
- [public/manifest.webmanifest](public/manifest.webmanifest), [public/sw.js](public/sw.js),
  [scripts/make-icons.mjs](scripts/make-icons.mjs) — PWA install + offline shell
- [lib/pro.js](lib/pro.js) — Pro entitlements (key minting, store) and the Stripe
  checkout/webhook calls, done with plain `fetch` + `crypto` (no SDK)
- [test/e2e.mjs](test/e2e.mjs) — plays complete rounds and asserts the whole flow,
  including Pro gating, activation and lapse

Rooms live in memory: restart the server and the rooms are gone (players are
offered the home screen and can create or join again).
