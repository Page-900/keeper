import { reviewGrant } from '../dist/brickken/grant.js';
import { mandateSummary } from '../dist/chain/mandate.js';

const print = (text) => process.stdout.write(`${text}\n`);

print('');
print('Asking Brickken to describe the same authority, and holding it against ours.');
print('This signs nothing and sends nothing.');
print('');

try {
  const { message, digest, nonce } = await reviewGrant();
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

print('');
