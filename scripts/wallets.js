import { createSignerKey } from '../dist/chain/client.js';

const ROLES = ['principal', 'agent'];

const print = (text) => process.stdout.write(`${text}\n`);

print('');
print('Generating one wallet per role. The keys go straight into app/.env.');
print('Only the addresses are printed. Share the address, never the key.');
print('');

for (const role of ROLES) {
  try {
    print(`  ${role.padEnd(10)} ${createSignerKey(role)}`);
  } catch (cause) {
    print(`  ${role.padEnd(10)} not created: ${cause instanceof Error ? cause.message : cause}`);
    process.exitCode = 1;
  }
}

print('');
print('These wallets have no recovery phrase. app/.env is the only copy.');
print('');
