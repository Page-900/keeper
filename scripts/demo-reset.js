import { readEtherBalance, readTokenBalance } from '../dist/chain/client.js';
import { resetDemoState, GAS_GRANT } from '../dist/demo/reset.js';
import {
  SUNL_DECIMALS,
  SUNL_SYMBOL,
  explorerTransaction,
  requireAddress,
} from '../dist/shared/config.js';

const UNIT = 10n ** BigInt(SUNL_DECIMALS);
const print = (text) => process.stdout.write(`${text}\n`);
const whole = (base) => `${base / UNIT} ${SUNL_SYMBOL}`;
const ether = (wei) => `${Number(wei) / 1e18} ETH`;

const buyer = requireAddress('counterparty');
const investor = requireAddress('principal');
const asset = requireAddress('asset');
const sending = process.argv.includes('--send');

print('');
print(`The buyer holds its whole concentration limit, so the guard refuses every sale it is`);
print(`offered, including an honest one. This returns the tokens and changes nothing else.`);
print(`No policy, no prompt, no cap. The mandate is not used and its budget is not touched.`);
print('');

try {
  const heldBefore = await readTokenBalance(asset, buyer);
  const investorBefore = await readTokenBalance(asset, investor);
  const gas = await readEtherBalance(buyer);

  print(`  investor now  ${whole(investorBefore)}`);
  print(`  buyer now     ${whole(heldBefore)}`);
  print(`  buyer gas     ${ether(gas)}`);
  print('');

  if (!sending) {
    print(`  This was a read. Nothing was sent.`);
    print(`  It would fund the buyer with ${ether(GAS_GRANT)} from the investor if it is short,`);
    print(`  simulate the return for free against the live token, and send it only if that works.`);
    print('');
    print(`  Run npm run demo:reset -- --send to do it.`);
  } else {
    const report = await resetDemoState();
    if (report.funded !== null)
      print(`  funded      ${explorerTransaction(report.funded.transactionHash)}`);
    print(`  returned    ${explorerTransaction(report.returned.transactionHash)}`);
    print('');
    print(`  read back off the chain, not from the receipt:`);
    print(`  investor    ${whole(report.investorHolds)}`);
    print(`  buyer       ${whole(report.buyerHolds)}`);
    print('');
    print(`Run npm run cap:table to write the new holder table into the evidence.`);
  }
} catch (cause) {
  print(`  not reset: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
