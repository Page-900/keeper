import { readTokenBalance } from '../dist/chain/client.js';
import { readRegistryState } from '../dist/chain/registry.js';
import { decide, proposedBy } from '../dist/keeper/decide.js';
import { simulateAgentAction } from '../dist/chain/action.js';
import { MODEL } from '../dist/keeper/model.js';
import { SUNL_DECIMALS, SUNL_SYMBOL, requireAddress } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);
const whole = (amount) => amount / 10n ** BigInt(SUNL_DECIMALS);

const reads = {
  state: () => readRegistryState(),
  balance: (holder, atBlock) => readTokenBalance(requireAddress('asset'), holder, atBlock),
};

print('');
print(`Keeper reads the offering material and decides. Nothing is sent and nothing is signed.`);
print(`The model is ${MODEL}. The guard that checks it has no model in it.`);
print('');

try {
  const made = await decide({ reads });
  const { reply } = made;
  const { intent, decision } = proposedBy(made);

  print(`  it proposed   ${intent.action} ${whole(intent.amount)} ${SUNL_SYMBOL}`);
  if (intent.recipient !== null) print(`  to            ${intent.recipient}`);
  print(`  because       ${intent.rationale}`);
  print('');
  print(`  the guard says ${decision.verdict.toUpperCase()}`);
  for (const refusal of decision.refusals)
    print(`    refused by the ${refusal.source}: ${refusal.rule}, ${refusal.detail}`);
  print('');

  if (decision.verdict === 'proceed') {
    await simulateAgentAction({ to: intent.recipient, amount: intent.amount });
    print('  the chain would accept it, simulated for free against the live registry');
    print('');
    print(
      '  Run npm run keeper:act to send it. That spends one of the actions the mandate has left.',
    );
  }

  print(`  thinking      ${reply.reasoning.slice(0, 300)}`);
} catch (cause) {
  print(`  no decision: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
