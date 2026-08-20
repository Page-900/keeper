import { grantMandateDigest, grantMandateMessage, mandateSummary } from '../dist/chain/mandate.js';
import { readRegistryState } from '../dist/chain/registry.js';
import { identityRef } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);
const SHAPE_ONLY = `0x${'0'.repeat(64)}`;

print('');
print('The authority the investor would be signing');
print('');

try {
  const state = await readRegistryState();
  const message = grantMandateMessage({
    nowSeconds: Math.floor(Date.now() / 1000),
    nonce: BigInt(state.principalNonce),
    identityRef: identityRef ?? SHAPE_ONLY,
  });

  for (const { label, value } of mandateSummary(message)) {
    print(`  ${label.padEnd(34)} ${value}`);
  }

  print('');
  print(
    `  Read at Sepolia block ${state.blockNumber}, and a mandate is ${state.mandateGranted ? 'already granted' : 'not granted yet'}.`,
  );
  print('');

  if (identityRef === null) {
    print('  NOT READY TO SIGN.');
    print('  Brickken have not issued the eligibility reference yet.');
    print('  The bound above is settled. The reference and the digest are not.');
    process.exitCode = 1;
  } else {
    print(`  Digest to sign  ${grantMandateDigest(message)}`);
    print('  Check every line above before signing. Nothing here has been sent.');
  }
} catch (cause) {
  print(`  not previewed: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
