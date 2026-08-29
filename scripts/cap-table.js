import { CAP_TABLE_FILE, composeCapTable, recordCapTable } from '../dist/captable.js';
import { SUNL_DECIMALS, SUNL_SYMBOL } from '../dist/shared/config.js';

const UNIT = 10n ** BigInt(SUNL_DECIMALS);
const print = (text) => process.stdout.write(`${text}\n`);

const whole = (base) => {
  const fraction = (base % UNIT).toString().padStart(SUNL_DECIMALS, '0').replace(/0+$/, '');
  return fraction === '' ? `${base / UNIT}` : `${base / UNIT}.${fraction}`;
};

const answered = (row) =>
  `Brickken report ${whole(row.reported)} from ${row.reportedBy}, cleared: ${row.cleared}`;

print('');
print(`Who holds ${SUNL_SYMBOL}, composed from what Brickken report and read back off the chain.`);
print('Brickken know who an investor is. The chain knows what a wallet holds. Both are needed.');
print('Being cleared to hold is a rule of the token itself, not the permission the agent uses.');
print('');

try {
  const table = await composeCapTable();
  print(`  at block ${table.block}, of ${whole(table.supply)} ${SUNL_SYMBOL} issued`);
  print('');
  for (const row of table.rows) {
    print(`  ${row.label}  ${row.wallet}`);
    print(`  holds ${whole(row.onChain)} ${SUNL_SYMBOL} on the chain. ${answered(row)}`);
    print('');
  }
  recordCapTable(CAP_TABLE_FILE, table);
  if (table.disagreements.length === 0) {
    print('  The two sides agree, and the rows account for everything the token has issued.');
  } else {
    print('  THEY DISAGREE. Recorded exactly as found, and resolved in favour of neither.');
    for (const disagreement of table.disagreements) print(`  ${disagreement}`);
    process.exitCode = 1;
  }
} catch (cause) {
  print(`  not composed: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
