import { reviewGrant } from '../dist/brickken/grant.js';
import { mandateSummary } from '../dist/chain/mandate.js';
import { KEEPER_MANDATE, PROBE_MANDATE } from '../dist/shared/config.js';

const SPECS = { keeper: KEEPER_MANDATE, probe: PROBE_MANDATE };

const print = (text) => process.stdout.write(`${text}\n`);

const wanted = process.argv[2] ?? 'keeper';
const spec = SPECS[wanted];

print('');

if (spec === undefined) {
  print(`  No such mandate: ${wanted}. Choose one of ${Object.keys(SPECS).join(', ')}.`);
  process.exitCode = 1;
} else {
  print(`Asking Brickken to describe the ${wanted} authority, and holding it against ours.`);
  print('This signs nothing and sends nothing.');
  print('');

  try {
    const { message, digest, nonce } = await reviewGrant(undefined, spec);
    for (const { label, value } of mandateSummary(message)) print(`  ${label.padEnd(34)} ${value}`);
    print('');
    print(`  Replay number agreed  ${nonce}`);
    print(`  Digest both describe  ${digest}`);
    print('');
    print('Brickken describe this authority exactly as this project does.');
  } catch (cause) {
    print(`  not agreed: ${cause instanceof Error ? cause.message : cause}`);
    process.exitCode = 1;
  }
}

print('');
