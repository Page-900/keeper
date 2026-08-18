import { spawnSync } from 'node:child_process';

import { CHECKS, FAILED, PASSED, render, report } from './checks.js';

const print = (text) => process.stdout.write(`${text}\n`);

const readLatestBlock = async () => {
  const { blockNumber } = await import('../dist/chain/client.js');
  return `Read block ${await blockNumber()}.`;
};

const ROLES = ['principal', 'agent'];

const confirmWallets = async () => {
  const { signerAddress } = await import('../dist/chain/client.js');
  const { requireAddress } = await import('../dist/shared/config.js');
  for (const role of ROLES) {
    const signer = signerAddress(role);
    const published = requireAddress(role);
    if (signer !== published)
      throw new Error(`The ${role} key signs as ${signer}, and the code publishes ${published}.`);
  }
  return `Both wallets match.`;
};

const confirmAsset = async () => {
  const { readTokenIdentity } = await import('../dist/chain/client.js');
  const { SUNL_DECIMALS, SUNL_SYMBOL, requireAddress } = await import('../dist/shared/config.js');
  const address = requireAddress('asset');
  const { symbol, decimals } = await readTokenIdentity(address);
  if (symbol !== SUNL_SYMBOL)
    throw new Error(`${address} calls itself ${symbol}, not ${SUNL_SYMBOL}.`);
  if (decimals !== SUNL_DECIMALS)
    throw new Error(
      `${symbol} has ${decimals} decimals, and every limit here is written in ${SUNL_DECIMALS}.`,
    );
  return `${symbol} answers at ${address} with ${decimals} decimals.`;
};

const confirmRecord = async () => {
  const { createBrickkenClient } = await import('../dist/brickken/client.js');
  const { SUNL_DECIMALS, SUNL_NAME, SUNL_SUPPLY_WHOLE, SUNL_SYMBOL, requireAddress } =
    await import('../dist/shared/config.js');
  const held = await createBrickkenClient().getTokenInfo(SUNL_SYMBOL);
  const intended = {
    tokenSymbol: SUNL_SYMBOL,
    tokenName: SUNL_NAME,
    decimals: SUNL_DECIMALS,
    maxSupply: Number(SUNL_SUPPLY_WHOLE),
    companyWallet: requireAddress('principal').toLowerCase(),
  };
  for (const [field, expected] of Object.entries(intended)) {
    const found = field === 'companyWallet' ? String(held[field]).toLowerCase() : held[field];
    if (found !== expected)
      throw new Error(`Brickken report ${field} as ${found}, and this project uses ${expected}.`);
  }
  return `${held.tokenName} is held as ${held.tokenSymbol}, ${held.maxSupply} tokens.`;
};

const confirmHolding = async () => {
  const { readTokenBalance } = await import('../dist/chain/client.js');
  const { PRINCIPAL_HOLDING, SUNL_SYMBOL, requireAddress } =
    await import('../dist/shared/config.js');
  const holder = requireAddress('principal');
  const held = await readTokenBalance(requireAddress('asset'), holder);
  if (held !== PRINCIPAL_HOLDING)
    throw new Error(
      `${holder} holds ${held} base units, and this project is written around ${PRINCIPAL_HOLDING}.`,
    );
  return `${holder} holds ${held / 10n ** 18n} ${SUNL_SYMBOL}.`;
};

const confirmAllowed = async () => {
  const { createBrickkenClient } = await import('../dist/brickken/client.js');
  const { SUNL_SYMBOL, requireAddress } = await import('../dist/shared/config.js');
  const holder = requireAddress('principal');
  const { isWhitelisted, source } = await createBrickkenClient().getWhitelistStatus(
    SUNL_SYMBOL,
    holder,
  );
  if (!isWhitelisted) throw new Error(`Brickken do not clear ${holder} to hold ${SUNL_SYMBOL}.`);
  return `Cleared, and they read it from the ${source}.`;
};

const confirmAllowance = async () => {
  const { readTokenAllowance } = await import('../dist/chain/client.js');
  const { MAX_CUMULATIVE_VALUE, PRINCIPAL_HOLDING, SUNL_SYMBOL, requireAddress } =
    await import('../dist/shared/config.js');
  const spender = requireAddress('executor');
  const allowed = await readTokenAllowance(
    requireAddress('asset'),
    requireAddress('principal'),
    spender,
  );
  if (allowed !== PRINCIPAL_HOLDING)
    throw new Error(
      `The executor may spend ${allowed} base units, and this project approved ${PRINCIPAL_HOLDING}.`,
    );
  if (allowed <= MAX_CUMULATIVE_VALUE)
    throw new Error(
      'The permission is not above the mandate total, so a refusal could not be attributed.',
    );
  return `${spender} may spend ${allowed / 10n ** 18n} ${SUNL_SYMBOL}.`;
};

const RUNNERS = {
  allowance: confirmAllowance,
  holding: confirmHolding,
  allowed: confirmAllowed,
  chain: readLatestBlock,
  wallets: confirmWallets,
  asset: confirmAsset,
  record: confirmRecord,
};

function runScript(script) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const finished = spawnSync(npm, ['run', script], { encoding: 'utf8', shell: true });
  if (finished.error) return { status: FAILED, output: finished.error.message };
  const output = `${finished.stdout}${finished.stderr}`;
  return finished.status === 0 ? { status: PASSED } : { status: FAILED, output };
}

const explain = (check, detail) =>
  check.whenFailed === undefined ? detail : `${check.whenFailed}\n\n${detail}`;

async function execute(check) {
  const runner = RUNNERS[check.id];
  try {
    if (runner) return { status: PASSED, detail: await runner() };
    if (!check.script) return { status: FAILED, output: 'This check has no way to run.' };
    return runScript(check.script);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { status: FAILED, output: explain(check, detail) };
  }
}

const results = new Map();

try {
  for (const check of CHECKS) {
    print(`running: ${check.title}`);
    results.set(check.id, await execute(check));
  }
} finally {
  const summary = report(results);
  print(render(summary));
  for (const row of summary.rows.filter((row) => row.status !== PASSED)) {
    print(`--- ${row.check.title} ---`);
    print(
      row.output === '' ? 'This check never ran, so nothing about it is verified.' : row.output,
    );
  }
  process.exitCode = summary.verified ? 0 : 1;
}
