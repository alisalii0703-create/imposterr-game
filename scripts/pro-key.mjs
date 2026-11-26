#!/usr/bin/env node
// Manage Pro keys by hand — comps, refunds, support, testing.
//   npm run pro:key list
//   npm run pro:key new  [--email you@example.com] [--note "friend"]
//   npm run pro:key grant IMP-AAAA-BBBB-CCCC
//   npm run pro:key revoke IMP-AAAA-BBBB-CCCC
//   npm run pro:key rm IMP-AAAA-BBBB-CCCC
import { readStore, mintKey, grant, revoke, removeKey, normalizeKey, status } from '../lib/pro.js';

const [cmd, arg, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  if (i !== -1 && rest[i + 1]) return rest[i + 1];
  if (arg && arg.startsWith(`--${name}=`)) return arg.split('=')[1];
  return null;
};
const email = flag('email');
const note = flag('note');

function printKey(key, state) {
  const until = state.until ? new Date(state.until * 1000).toISOString().slice(0, 10) : '—';
  console.log(`  ${key}  ${state.active ? 'ACTIVE' : state.status.toUpperCase()}  renews/ends: ${until}${state.email ? `  ${state.email}` : ''}`);
}

switch (cmd) {
  case 'list': {
    const keys = readStore().keys;
    const entries = Object.entries(keys);
    if (!entries.length) console.log('No keys yet. `npm run pro:key new` mints one.');
    for (const [key] of entries) printKey(key, status(key));
    break;
  }
  case 'new': {
    const key = mintKey();
    grant(key, { email, note, source: 'manual' });
    console.log(`Created Pro key:\n\n  ${key}\n`);
    console.log('Give it to the player; they redeem it under Get Pro → "I already subscribed".');
    break;
  }
  case 'grant': {
    const key = normalizeKey(arg);
    if (!key) { console.error('Usage: npm run pro:key grant IMP-AAAA-BBBB-CCCC'); process.exit(1); }
    grant(key, { email, note, source: 'manual' });
    console.log(`Granted ${key} → ACTIVE`);
    break;
  }
  case 'revoke': {
    const key = normalizeKey(arg);
    if (!key) { console.error('Usage: npm run pro:key revoke IMP-AAAA-BBBB-CCCC'); process.exit(1); }
    revoke(key);
    console.log(`Revoked ${key}`);
    break;
  }
  case 'rm': {
    const key = normalizeKey(arg);
    if (!key) { console.error('Usage: npm run pro:key rm IMP-AAAA-BBBB-CCCC'); process.exit(1); }
    removeKey(key);
    console.log(`Deleted ${key} from the store`);
    break;
  }
  default:
    console.log('Usage: npm run pro:key <list|new|grant|revoke|rm> [key] [--email x] [--note y]');
    process.exit(1);
}
