#!/usr/bin/env node
// Doctor for the Pro payment setup: checks every piece and says exactly what is
// missing. Never prints a secret value — only whether it is set and looks sane.
const env = process.env;
const PRICE = 990;
let problems = 0;

const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { problems += 1; console.error(`  ✗ ${msg}`); };
const warn = (msg) => console.log(`  ! ${msg}`);

console.log('IMposter Pro — payment setup check\n');

const key = env.STRIPE_SECRET_KEY;
if (!key) {
  bad('STRIPE_SECRET_KEY is not set → copy .env.example to .env and add your secret key');
} else if (!/^sk_(test|live)_/.test(key)) {
  bad('STRIPE_SECRET_KEY does not look like a secret key (sk_test_… / sk_live_…)');
} else {
  ok(`STRIPE_SECRET_KEY is set (${key.startsWith('sk_live') ? 'live' : 'test'} mode)`);
  if (key.startsWith('sk_live')) warn('live key: real cards will be charged');
}

const priceId = env.STRIPE_PRICE_ID;
if (!priceId) {
  bad('STRIPE_PRICE_ID is not set → run `npm run stripe:setup`');
} else if (!/^price_/.test(priceId)) {
  bad('STRIPE_PRICE_ID does not look like a price id (price_…)');
}

const hookSecret = env.STRIPE_WEBHOOK_SECRET;
if (!hookSecret) {
  bad('STRIPE_WEBHOOK_SECRET is not set → add the endpoint https://<host>/api/stripe/webhook in Stripe, then paste its signing secret');
} else if (!/^whsec_/.test(hookSecret)) {
  bad('STRIPE_WEBHOOK_SECRET does not look like a signing secret (whsec_…)');
} else {
  ok('STRIPE_WEBHOOK_SECRET is set');
}

const origin = env.APP_ORIGIN;
if (!origin) {
  bad('APP_ORIGIN is not set → Stripe redirects need the public URL, e.g. https://imposter.example.com');
} else if (!/^https?:\/\//.test(origin)) {
  bad('APP_ORIGIN must start with http:// or https://');
} else if (/localhost|127\.0\.0\.1/.test(origin)) {
  warn(`APP_ORIGIN is ${origin} — fine for local testing, but Stripe needs a public URL for real players`);
} else {
  ok(`APP_ORIGIN is ${origin}`);
}

// Ask Stripe about the price so a wrong amount can't slip through.
if (key && priceId && /^sk_(test|live)_/.test(key) && /^price_/.test(priceId)) {
  try {
    const res = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    const price = await res.json().catch(() => ({}));
    if (!res.ok) {
      bad(`Stripe rejected the price lookup: ${(price.error && price.error.message) || res.status}`);
    } else if (price.unit_amount !== PRICE) {
      bad(`price ${priceId} is ${price.unit_amount} ${price.currency}, expected ${PRICE} — create the $9.90 price with \`npm run stripe:setup\``);
    } else if (!price.recurring || price.recurring.interval !== 'month') {
      bad(`price ${priceId} is not a monthly subscription price`);
    } else {
      ok(`price ${priceId} is ${(price.unit_amount / 100).toFixed(2)} ${price.currency.toUpperCase()}/${price.recurring.interval}, active=${price.active}`);
    }
  } catch (err) {
    bad(`could not reach Stripe: ${err.message}`);
  }
}

// Is the running game advertising a configured paywall?
const base = (origin || `http://localhost:${env.PORT || 5173}`).replace(/\/$/, '');
try {
  const res = await fetch(`${base}/api/pro/status?key=doctor`, { signal: AbortSignal.timeout(4000) });
  const body = await res.json();
  if (body.configured) ok(`running server at ${base} reports Pro checkout configured`);
  else bad(`running server at ${base} still reports checkout as not configured — restart it after setting the keys`);
} catch {
  warn(`no server answering at ${base} — start it with \`npm start\` and re-run this check`);
}

console.log(problems ? `\n${problems} thing(s) to fix.` : '\nAll set — Pro checkout is ready.');
process.exit(problems ? 1 : 0);
