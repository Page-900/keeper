import { grantMandateDigest, grantMandateMessage, mandateSummary } from '../dist/chain/mandate.js';
import { readRegistryState } from '../dist/chain/registry.js';
import { identityRef } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);

print('');
print('The authority the investor would be signing');
print('');

try {
  const state = await readRegistryState();
  const message = grantMandateMessage({
    nowSeconds: Math.floor(Date.now() / 1000),
    nonce: BigInt(state.principalNonce),
    identityRef,
  });

  for (const { label, value } of mandateSummary(message)) {
    print(`  ${label.padEnd(34)} ${value}`);
  }

  print('');
  print(
    `  Read at Sepolia block ${state.blockNumber}, and a mandate is ${state.mandateGranted ? 'already granted' : 'not granted yet'}.`,
  );
  print('');

  print(`  Digest to sign  ${grantMandateDigest(message)}`);
  print('  Check every line above before signing. Nothing here has been sent.');
} catch (cause) {
  print(`  not previewed: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
