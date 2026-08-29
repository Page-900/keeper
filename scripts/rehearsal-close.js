import {
  OFFERING_CLOSES,
  attemptClose,
  heldOffering,
  phaseAt,
  recordClose,
} from '../dist/brickken/offering.js';
import { REHEARSAL } from '../dist/shared/tokens.js';
import { explorerTransaction } from '../dist/shared/config.js';

const print = (text) =>
  process.stdout.write(`${text}
`);

print('');

try {
  const held = await heldOffering(REHEARSAL);
  if (held === null) {
    print(`  Brickken list no offering on ${REHEARSAL.symbol}, so there is nothing to close.`);
    process.exitCode = 1;
  } else {
    const phase = phaseAt(Date.now(), held.startDate, held.endDate);
    print(`Trying to close the ${REHEARSAL.symbol} offering ${phase}.`);
    print(`Brickken call it ${held.status}. It opens ${held.startDate} and ends ${held.endDate}.`);
    print('');
    const attempt = recordClose(OFFERING_CLOSES, await attemptClose(phase, { spec: REHEARSAL }));
    if (attempt.closed) {
      print(`  IT CLOSED, ${phase}.`);
      print(`  ${explorerTransaction(attempt.transactionHash)}`);
    } else {
      print(`  IT WOULD NOT CLOSE, ${phase}.`);
      print(`  ${attempt.refusal}`);
    }
    print('');
    print('  Recorded either way. A refusal is the answer, not a failure of this run.');
  }
} catch (cause) {
  print(`  not attempted: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
