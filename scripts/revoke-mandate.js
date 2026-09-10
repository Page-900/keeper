import { revokeMandate } from '../dist/brickken/revoke.js';
import { readRegistryState } from '../dist/chain/registry.js';
import { RETIRED_FILE, recordRetired } from '../dist/chain/retired.js';
import { KEEPER_MANDATE, SUNL_SYMBOL, explorerTransaction } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);
const whole = (base) => BigInt(base) / 10n ** 18n;

const AGENTS = ['agent', 'router'];

print('');
print('Revoking the live mandate through Brickken, signed by the investor.');
print(
  'What it spent is written down after it lands, because a fresh grant sets that total to zero.',
);
print('');

try {
  const states = [];
  for (const agent of AGENTS) {
    const state = await readRegistryState({ agent });
    if (state.mandateGranted && !state.mandateRevoked) states.push({ agent, state });
  }
  if (states.length !== 1)
    throw new Error(
      `${states.length} mandates are live, and this revokes exactly one: ${states.map((one) => one.agent).join(', ') || 'none'}`,
    );

  const [{ agent, state }] = states;
  print(`  revoking the mandate held by ${agent} at ${state.mandateAgent}`);
  print(
    `  it has spent ${whole(state.cumulativeUsed)} ${SUNL_SYMBOL}, read at block ${state.blockNumber}`,
  );
  print('');

  const { txId, transactionHash } = await revokeMandate({ spec: { ...KEEPER_MANDATE, agent } });

  const kept = recordRetired(RETIRED_FILE, {
    agent: state.mandateAgent,
    atBlock: state.blockNumber,
    cumulativeUsed: state.cumulativeUsed,
  });
  print(`  prepared    ${txId}`);
  print(`  transaction ${explorerTransaction(transactionHash)}`);
  print(
    `  kept        ${whole(kept.cumulativeUsed)} ${SUNL_SYMBOL} in evidence/retired-mandates.jsonl`,
  );
  print('');
  print('Run npm run read:registry to read the revoked mandate back off the chain.');
} catch (cause) {
  print(`  not revoked: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
