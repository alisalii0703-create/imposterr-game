#!/usr/bin/env node
// Creates the $9.90/month "IMposter Pro" price in your Stripe account and
// prints the price id to paste into .env. Re-running is safe: it reuses an
// existing product/price instead of making duplicates.
const KEY = process.env.STRIPE_SECRET_KEY;
const AMOUNT = 990;
const CURRENCY = 'usd';
const PRODUCT_NAME = 'IMposter Pro';

if (!KEY) {
  console.error('✗ STRIPE_SECRET_KEY is not set.');
  console.error('  Put it in .env (copy .env.example) or in the project secrets, then re-run:');
  console.error('    npm run stripe:setup');
  process.exit(1);
}
const live = KEY.startsWith('sk_live');
console.log(`Mode: ${live ? 'LIVE — real charges' : 'test'}  ·  price: $9.90/month`);

async function api(method, path, params) {
  const init = { method, headers: { authorization: `Bearer ${KEY}` } };
  if (params) {
    init.headers['content-type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(params).toString();
  }
  const res = await fetch(`https://api.stripe.com/v1${path}`, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json.error && json.error.message) || `Stripe HTTP ${res.status}`);
  return json;
}

try {
  const acct = await api('GET', '/account');
  const who = (acct.settings && acct.settings.dashboard && acct.settings.dashboard.display_name) || acct.id;
  console.log(`Account: ${who}`);

  const products = await api('GET', '/products?limit=100&active=true');
  let product = products.data.find((p) => p.name === PRODUCT_NAME);
  if (product) {
    console.log(`✓ product exists: ${product.id}`);
  } else {
    product = await api('POST', '/products', {
      name: PRODUCT_NAME,
      description: '18 niche + fun word packs, unlocked for everyone in the host’s room.',
    });
    console.log(`✓ created product: ${product.id}`);
  }

  const prices = await api('GET', `/prices?limit=100&active=true&product=${product.id}`);
  let price = prices.data.find(
    (p) => p.unit_amount === AMOUNT && p.currency === CURRENCY && p.recurring && p.recurring.interval === 'month'
  );
  if (price) {
    console.log(`✓ price exists: ${price.id} ($9.90/month)`);
  } else {
    price = await api('POST', '/prices', {
      product: product.id,
      unit_amount: String(AMOUNT),
      currency: CURRENCY,
      'recurring[interval]': 'month',
      nickname: 'Pro monthly',
    });
    console.log(`✓ created price: ${price.id} ($9.90/month)`);
  }

  console.log('\nAdd this to .env (or the project secrets):');
  console.log(`STRIPE_PRICE_ID=${price.id}`);
  console.log('\nThen: npm run stripe:check');
  if (live) console.log('\n⚠ This is a live key — anyone who completes checkout will be charged for real.');
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
}
