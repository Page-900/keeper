import { spawnSync } from 'node:child_process';

import { CHECKS, FAILED, PASSED, render, report } from './checks.js';

const print = (text) => process.stdout.write(`${text}\n`);

const readLatestBlock = async () => {
  const { blockNumber } = await import('../dist/chain/client.js');
  return `Read block ${await blockNumber()}.`;
};

const ROLES = ['principal', 'agent', 'counterparty'];

const confirmWallets = async () => {
  const { signerAddress } = await import('../dist/chain/client.js');
  const { requireAddress } = await import('../dist/shared/config.js');
  for (const role of ROLES) {
    const signer = signerAddress(role);
    const published = requireAddress(role);
    if (signer !== published)
      throw new Error(`The ${role} key signs as ${signer}, and the code publishes ${published}.`);
  }
  return `All ${ROLES.length} wallets match.`;
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
  const spent = BigInt((await registryState()).cumulativeUsed);
  if (held !== PRINCIPAL_HOLDING - spent)
    throw new Error(
      `${holder} holds ${held} base units, and the holding minus what the agent spent is ${PRINCIPAL_HOLDING - spent}.`,
    );
  return `${holder} holds ${held / 10n ** 18n} ${SUNL_SYMBOL} of the ${PRINCIPAL_HOLDING / 10n ** 18n} it started with.`;
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
  const spent = BigInt((await registryState()).cumulativeUsed);
  if (allowed !== PRINCIPAL_HOLDING - spent)
    throw new Error(
      `The executor may spend ${allowed} base units, and the approval minus what it has spent is ${PRINCIPAL_HOLDING - spent}.`,
    );
  if (allowed <= MAX_CUMULATIVE_VALUE - spent)
    throw new Error(
      'The permission is not above what the mandate still allows, so a refusal could not be attributed.',
    );
  return `${spender} may still spend ${allowed / 10n ** 18n} ${SUNL_SYMBOL}, above the ${(MAX_CUMULATIVE_VALUE - spent) / 10n ** 18n} the mandate has left.`;
};

let reading;

/** One read serves every row below it, so the table describes a single block. */
const registryState = async () => {
  const { readRegistryState } = await import('../dist/chain/registry.js');
  reading ??= readRegistryState();
  return reading;
};

const confirmEligibility = async () => {
  const state = await registryState();
  if (!state.principalEligible)
    throw new Error(
      `The compliance contract answers reason code ${state.eligibilityReason} for ${state.principal}.`,
    );
  const expiry =
    state.eligibilityExpiresAt === '0'
      ? 'with no expiry, so there is nothing to renew'
      : `until ${new Date(Number(state.eligibilityExpiresAt) * 1000).toISOString()}`;
  return `${state.principal} is eligible, ${expiry}.`;
};

const confirmRecorder = async () => {
  const state = await registryState();
  if (!state.executorMayRecord)
    throw new Error(`The registry does not let ${state.executor} record an execution.`);
  return `${state.executor} may record.`;
};

const confirmMandate = async () => {
  const {
    MANDATE_ACTIONS,
    MAX_CUMULATIVE_VALUE,
    MAX_TRANSACTION_VALUE,
    SUNL_SYMBOL,
    requireAddress,
  } = await import('../dist/shared/config.js');
  const state = await registryState();
  if (!state.mandateGranted)
    throw new Error('No mandate is granted, so there is nothing to check.');
  const expected = {
    'the agent': [state.mandateAgent, requireAddress('agent')],
    'the token': [state.mandateAsset, requireAddress('asset')],
    'the per-transfer limit': [state.maxTransactionValue, String(MAX_TRANSACTION_VALUE)],
    'the total limit': [state.maxCumulativeValue, String(MAX_CUMULATIVE_VALUE)],
  };
  for (const [what, [found, meant]] of Object.entries(expected)) {
    if (String(found).toLowerCase() !== String(meant).toLowerCase())
      throw new Error(`The chain reports ${what} as ${found}, and this project uses ${meant}.`);
  }
  if (state.mandateRevoked) throw new Error('The mandate on the chain is revoked.');
  if (!state.actionEnabled)
    throw new Error(`The chain does not have ${MANDATE_ACTIONS[0]} enabled on the mandate.`);
  const spent = BigInt(state.cumulativeUsed) / 10n ** 18n;
  const total = MAX_CUMULATIVE_VALUE / 10n ** 18n;
  return `One action, ${MAX_TRANSACTION_VALUE / 10n ** 18n} ${SUNL_SYMBOL} at a time, ${spent} of ${total} used.`;
};

const confirmMoved = async () => {
  const { readTokenBalance } = await import('../dist/chain/client.js');
  const { PRINCIPAL_HOLDING, SUNL_DECIMALS, SUNL_SYMBOL, requireAddress } =
    await import('../dist/shared/config.js');
  const state = await registryState();
  const asset = requireAddress('asset');
  const moved = BigInt(state.cumulativeUsed);
  const held = await readTokenBalance(asset, requireAddress('counterparty'));
  const left = await readTokenBalance(asset, requireAddress('principal'));
  const whole = (amount) => amount / 10n ** BigInt(SUNL_DECIMALS);
  if (held !== moved)
    throw new Error(
      `The counterparty holds ${whole(held)} and the registry recorded ${whole(moved)} as spent.`,
    );
  if (left !== PRINCIPAL_HOLDING - moved)
    throw new Error(
      `The investor holds ${whole(left)}, and ${whole(PRINCIPAL_HOLDING)} less ${whole(moved)} is not that.`,
    );
  return `${whole(moved)} ${SUNL_SYMBOL} moved, and the investor has ${whole(left)} left.`;
};

const confirmWindow = async () => {
  const { MANDATE_MUST_HOLD_UNTIL, MANDATE_MUST_HOLD_UNTIL_ISO, mandateWindow } =
    await import('../dist/shared/config.js');
  const state = await registryState();
  const subject = state.mandateGranted ? 'The granted mandate' : 'A mandate granted now';
  const endsAt = state.mandateGranted
    ? BigInt(state.mandateValidUntil)
    : BigInt(mandateWindow(Math.floor(Date.now() / 1000)).validUntil);
  const readable = new Date(Number(endsAt) * 1000).toISOString();
  if (endsAt <= MANDATE_MUST_HOLD_UNTIL)
    throw new Error(`${subject} ends at ${readable}, before ${MANDATE_MUST_HOLD_UNTIL_ISO}.`);
  return `${subject} runs to ${readable}, past ${MANDATE_MUST_HOLD_UNTIL_ISO}.`;
};

const RUNNERS = {
  allowance: confirmAllowance,
  holding: confirmHolding,
  allowed: confirmAllowed,
  chain: readLatestBlock,
  eligibility: confirmEligibility,
  recorder: confirmRecorder,
  mandate: confirmMandate,
  moved: confirmMoved,
  window: confirmWindow,
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
