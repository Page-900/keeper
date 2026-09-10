import { allowRecipient } from '../dist/chain/router.js';
import { addressSlots, explorerTransaction, requireAddress } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);
const name = process.argv[2];
const known = Object.keys(addressSlots).filter((slot) => addressSlots[slot] !== null);

print('');

if (name === undefined || !known.includes(name)) {
  print('Say which address to list, by the name the config module gives it.');
  print('');
  print(`  npm run router:allow -- ${known[0] ?? 'name'}`);
  print('');
  print(`Names it knows: ${known.join(', ')}`);
  print('');
  print('An address the config module does not hold cannot be listed from here.');
  print('Add it there first, so the address a judge reads is the address the code uses.');
  process.exitCode = 1;
} else {
  print(`Listing ${name} at ${requireAddress(name)} as an address the router may deliver to.`);
  print('It is signed by the investor wallet, which owns the router. Nobody else can do this.');
  print('');
  try {
    const { transactionHash, blockNumber } = await allowRecipient(name);
    print(`  block       ${blockNumber}`);
    print(`  transaction ${explorerTransaction(transactionHash)}`);
    print('');
    print('The router was read back off the chain and it now allows that address.');
    print(
      'The guard still has its own list, so add the name there too before the agent will use it.',
    );
  } catch (cause) {
    print(`  not listed: ${cause instanceof Error ? cause.message : cause}`);
    process.exitCode = 1;
  }
}

print('');
