// IMposter Pro — subscription entitlements + Stripe checkout.
// No SDK: Node's fetch + crypto cover the two calls we need, so the app keeps
// its zero-dependency-on-the-server promise (ws is the only package).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PRO = {
  name: 'IMPOSTER Pro',
  priceCents: 990,
  priceLabel: '$9.90',
  period: 'month',
  currency: 'usd',
  blurb: 'Every niche + fun word pack, plus first access to new ones.',
};

const STORE_PATH = process.env.PRO_STORE || path.join(import.meta.dirname, '..', 'data', 'pro.json');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let cache = { mtimeMs: 0, data: null };

export function readStore() {
  try {
    const st = fs.statSync(STORE_PATH);
    if (cache.data && cache.mtimeMs === st.mtimeMs) return cache.data;
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    cache = { mtimeMs: st.mtimeMs, data: { keys: raw.keys || {} } };
    return cache.data;
  } catch {
    return { keys: {} };
  }
}

function writeStore(data) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
  cache = { mtimeMs: 0, data };
}

export function mintKey() {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  return `IMP-${part()}-${part()}-${part()}`;
}

// "imp 7k3q 9xz2 m4rt" -> "IMP-7K3Q-9XZ2-M4RT" (null when it can't be one)
export function normalizeKey(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== 15 || !s.startsWith('IMP')) return null;
  return `${s.slice(0, 3)}-${s.slice(3, 7)}-${s.slice(7, 11)}-${s.slice(11, 15)}`;
}

// Keys the operator hands out by hand (support, refunds, freebies, tests).
function compedKeys() {
  return String(process.env.PRO_KEYS || '')
    .split(',')
    .map(normalizeKey)
    .filter(Boolean);
}

export function status(raw) {
  const key = normalizeKey(raw);
  if (!key) return { key: null, active: false, status: 'invalid' };
  if (compedKeys().includes(key)) return { key, active: true, status: 'active', comped: true, until: null };

  const rec = readStore().keys[key];
  if (!rec) return { key, active: false, status: 'unknown' };
  const expired = rec.currentPeriodEnd && rec.currentPeriodEnd * 1000 < Date.now();
  const active = rec.status === 'active' && !expired;
  return { key, active, status: active ? 'active' : (expired ? 'expired' : rec.status), until: rec.currentPeriodEnd || null };
}

export function addPending(key, info = {}) {
  const data = readStore();
  data.keys[normalizeKey(key)] = { status: 'pending', createdAt: Date.now(), ...info };
  writeStore(data);
}

export function grant(key, info = {}) {
  const data = readStore();
  data.keys[normalizeKey(key)] = { status: 'active', createdAt: Date.now(), ...info };
  writeStore(data);
}

export function removeKey(key) {
  const data = readStore();
  delete data.keys[normalizeKey(key)];
  writeStore(data);
}

export function revoke(key) {
  const data = readStore();
  const k = normalizeKey(key);
  if (data.keys[k]) {
    data.keys[k].status = 'canceled';
    data.keys[k].canceledAt = Date.now();
    writeStore(data);
  }
}

// ------------------------------------------------------------------- stripe
export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

export async function createCheckout({ origin, key }) {
  const params = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': process.env.STRIPE_PRICE_ID,
    'line_items[0][quantity]': '1',
    client_reference_id: key,
    'metadata[key]': key,
    'subscription_data[metadata][key]': key,
    success_url: `${origin}/?pro=${encodeURIComponent(key)}`,
    cancel_url: `${origin}/?pro=cancel`,
    allow_promotion_codes: 'true',
  });
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json && json.error && json.error.message) || `stripe ${res.status}`);
  return json;
}

// The buyer lands back on `/?pro=KEY` after paying. Rather than waiting for a
// webhook (which needs a publicly reachable endpoint), ask Stripe straight out
// whether that checkout session was paid, and unlock if it was.
const lastConfirmCheck = new Map();

export async function confirmPending(raw) {
  const key = normalizeKey(raw);
  if (!key || !process.env.STRIPE_SECRET_KEY) return null;

  const rec = readStore().keys[key];
  if (!rec || rec.status === 'active' || !rec.sessionId) return null;

  // The client polls every couple of seconds; don't hammer Stripe.
  const last = lastConfirmCheck.get(key) || 0;
  if (Date.now() - last < 4000) return null;
  lastConfirmCheck.set(key, Date.now());

  try {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(rec.sessionId)}`, {
      headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    });
    const session = await res.json().catch(() => ({}));
    if (!res.ok) return null;

    const paid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
    if (!paid || session.status !== 'complete') return null;

    const email =
      (session.customer_details && session.customer_details.email) || session.customer_email || rec.email || null;
    patchByKey(key, {
      status: 'active',
      customerId: session.customer || null,
      subscriptionId: session.subscription || null,
      email,
      activatedAt: Date.now(),
    });
    return { key, active: true };
  } catch {
    return null;
  }
}

// Stripe sends `t=<ts>,v1=<sig>`; HMAC-SHA256 over "<ts>.<raw body>".
export function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = {};
  for (const kv of String(header).split(',')) {
    const i = kv.indexOf('=');
    if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  const t = Number(parts.t);
  if (!t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1, 'hex');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function patchByKey(key, patch) {
  const k = normalizeKey(key);
  const data = readStore();
  if (!data.keys[k]) return false;
  data.keys[k] = { ...data.keys[k], ...patch };
  writeStore(data);
  return true;
}

function keyForSubscription(subId) {
  if (!subId) return null;
  const keys = readStore().keys;
  for (const [key, rec] of Object.entries(keys)) if (rec.subscriptionId === subId) return key;
  return null;
}

// Applies a verified Stripe event to the entitlement store. Idempotent.
export function handleStripeEvent(event) {
  const type = event && event.type;
  const obj = (event && event.data && event.data.object) || {};
  const fromMeta = (obj.metadata && obj.metadata.key) || null;

  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    const key = obj.client_reference_id || fromMeta;
    if (!key) return;
    const email = (obj.customer_details && obj.customer_details.email) || obj.customer_email || null;
    const rec = readStore().keys[normalizeKey(key)] || {};
    if (!patchByKey(key, {
      status: 'active',
      sessionId: obj.id || null,
      customerId: obj.customer || null,
      subscriptionId: obj.subscription || null,
      email: email || rec.email || null,
      activatedAt: Date.now(),
    })) {
      grant(key, { sessionId: obj.id || null, customerId: obj.customer || null, subscriptionId: obj.subscription || null, email });
    }
    return;
  }

  if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
    const key = fromMeta || keyForSubscription(obj.id);
    if (!key) return;
    const live = obj.status === 'active' || obj.status === 'trialing';
    patchByKey(key, {
      status: live ? 'active' : 'canceled',
      subscriptionId: obj.id || null,
      customerId: obj.customer || null,
      currentPeriodEnd: obj.current_period_end || null,
    });
    return;
  }

  if (type === 'customer.subscription.deleted' || type === 'invoice.payment_failed') {
    const key = (type === 'customer.subscription.deleted' ? (fromMeta || keyForSubscription(obj.id)) : keyForSubscription(obj.subscription));
    if (key) patchByKey(key, { status: 'canceled', canceledAt: Date.now() });
  }
}
