import { spawnSync } from 'node:child_process';

import { ANCHOR_FILE } from '../dist/chain/anchors.js';
import { signerAddress } from '../dist/chain/client.js';
import { requireAddress } from '../dist/shared/config.js';
import { readRecords } from '../dist/shared/jsonl.js';

const print = (text) => process.stdout.write(`${text}\n`);

const deployed = readRecords(ANCHOR_FILE).find(
  (anchor) => anchor.action === 'deploy-executor' && anchor.status === 'success',
);

if (deployed === undefined) {
  print('Nothing is deployed yet, so there is no source to verify.');
  process.exit(1);
}

const principal = signerAddress('principal');
const cli = 'node_modules/hardhat/dist/src/cli.js';
const args = [requireAddress('agentMandate'), principal, principal];

print('');
print(`Publishing the source of ${deployed.contract} so a reader can check it themselves.`);
print('');

const finished = spawnSync(
  process.execPath,
  [cli, 'verify', '--network', 'sepolia', deployed.contract, ...args],
  { stdio: 'inherit' },
);

process.exitCode = finished.status ?? 1;
