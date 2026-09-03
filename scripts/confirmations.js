import { PAGE_RUNNERS } from './page.js';
import { registryState } from './registry-state.js';
import { REFUSAL_RUNNERS } from './refusals.js';

const readLatestBlock = async () => {
  const { blockNumber } = await import('../dist/chain/client.js');
  return `Read block ${await blockNumber()}.`;
};

const confirmWallets = async () => {
  const { SIGNER_ROLES, signerAddress } = await import('../dist/chain/client.js');
  const { requireAddress } = await import('../dist/shared/config.js');
  for (const role of SIGNER_ROLES) {
    const signer = signerAddress(role);
    const published = requireAddress(role);
    if (signer !== published)
      throw new Error(`The ${role} key signs as ${signer}, and the code publishes ${published}.`);
  }
  return `All ${SIGNER_ROLES.length} wallets match.`;
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
  const { returnedByBuyer } = await import('../dist/demo/reset.js');
  const { PRINCIPAL_HOLDING, SUNL_SYMBOL, requireAddress } =
    await import('../dist/shared/config.js');
  const holder = requireAddress('principal');
  const held = await readTokenBalance(requireAddress('asset'), holder);
  const spent = BigInt((await registryState()).cumulativeUsed);
  const back = await returnedByBuyer();
  const expected = PRINCIPAL_HOLDING - spent + back;
  if (held !== expected)
    throw new Error(
      `${holder} holds ${held} base units, and the holding less what the agent spent plus what the buyer sent back is ${expected}.`,
    );
  return `${holder} holds ${held / 10n ** 18n} ${SUNL_SYMBOL} of the ${PRINCIPAL_HOLDING / 10n ** 18n} it started with, after ${spent / 10n ** 18n} spent and ${back / 10n ** 18n} returned.`;
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

/** A re-grant resets the registry counter and never the approval, so the sends are counted. */
const probeDrawn = async () => {
  const { ANCHOR_FILE } = await import('../dist/chain/anchors.js');
  const { readRecords } = await import('../dist/shared/jsonl.js');
  const { PROBE_MANDATE } = await import('../dist/shared/config.js');
  const sent = new Set(
    readRecords(ANCHOR_FILE)
      .filter((a) => String(a.action).startsWith('battery-legal') && a.status === 'success')
      .map((a) => a.transactionHash),
  );
  return BigInt(sent.size) * PROBE_MANDATE.maxTransactionValue;
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
  const probeSpent = await probeDrawn();
  const drawn = spent + probeSpent;
  if (allowed !== PRINCIPAL_HOLDING - drawn)
    throw new Error(
      `The executor may spend ${allowed} base units. Every mandate that draws on it has spent ${drawn} of the ${PRINCIPAL_HOLDING} approved, which leaves ${PRINCIPAL_HOLDING - drawn}.`,
    );
  if (allowed <= MAX_CUMULATIVE_VALUE - spent)
    throw new Error(
      'The permission is not above what the mandate still allows, so a refusal could not be attributed.',
    );
  return `${spender} may still spend ${allowed / 10n ** 18n} ${SUNL_SYMBOL}, above the ${(MAX_CUMULATIVE_VALUE - spent) / 10n ** 18n} the investor mandate has left. The probe mandates have drawn ${probeSpent / 10n ** 18n} of the same approval across every cycle.`;
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
  const { returnedByBuyer } = await import('../dist/demo/reset.js');
  const { PRINCIPAL_HOLDING, SUNL_DECIMALS, SUNL_SYMBOL, requireAddress } =
    await import('../dist/shared/config.js');
  const state = await registryState();
  const asset = requireAddress('asset');
  const moved = BigInt(state.cumulativeUsed);
  const back = await returnedByBuyer();
  const held = await readTokenBalance(asset, requireAddress('counterparty'));
  const left = await readTokenBalance(asset, requireAddress('principal'));
  const whole = (amount) => amount / 10n ** BigInt(SUNL_DECIMALS);
  if (held !== moved - back)
    throw new Error(
      `The counterparty holds ${whole(held)}, and the ${whole(moved)} the registry recorded as spent less the ${whole(back)} it sent back is not that.`,
    );
  if (left + held !== PRINCIPAL_HOLDING)
    throw new Error(
      `The investor holds ${whole(left)} and the counterparty ${whole(held)}, which do not add up to the ${whole(PRINCIPAL_HOLDING)} ever issued to them, so some of it is somewhere else.`,
    );
  return `${whole(moved)} ${SUNL_SYMBOL} moved and ${whole(back)} came back, the investor has ${whole(left)} and the counterparty ${whole(held)}, and nothing is anywhere else.`;
};

const confirmKeeper = async () => {
  const { readRecords } = await import('../dist/shared/jsonl.js');
  const { ANCHOR_FILE } = await import('../dist/chain/anchors.js');
  const { GUARD_FILE } = await import('../dist/keeper/guard.js');
  const { transactionReceipt } = await import('../dist/chain/client.js');
  const { SUNL_DECIMALS, SUNL_SYMBOL } = await import('../dist/shared/config.js');

  const anchor = readRecords(ANCHOR_FILE)
    .filter((record) => record.action === 'keeper-action')
    .at(-1);
  if (anchor === undefined)
    throw new Error('The agent has not acted on a decision yet, so there is nothing to read.');

  const receipt = await transactionReceipt(anchor.transactionHash);
  if (receipt.status !== 'success')
    throw new Error(`${anchor.transactionHash} reads as ${receipt.status} on the test network.`);

  const decision = readRecords(GUARD_FILE)
    .filter((record) => record.verdict === 'proceed')
    .at(-1);
  if (decision === undefined) throw new Error('No decision the guard passed is on record.');

  const state = await registryState();
  const whole = (amount) => amount / 10n ** BigInt(SUNL_DECIMALS);
  const chose = BigInt(decision.amount);
  if (chose > BigInt(state.maxTransactionValue))
    throw new Error(`The agent chose ${whole(chose)}, above the limit the mandate publishes.`);
  if (BigInt(state.cumulativeUsed) < chose)
    throw new Error(`The registry has counted less than the ${whole(chose)} the agent chose.`);

  return `The agent chose ${whole(chose)} ${SUNL_SYMBOL}, and its transaction succeeded in block ${receipt.blockNumber}.`;
};

const confirmReadings = async () => {
  const { readMandateOverCli } = await import('../dist/brickken/cli.js');
  const { SUNL_DECIMALS, SUNL_SYMBOL } = await import('../dist/shared/config.js');
  const state = await registryState();
  if (!state.mandateGranted)
    throw new Error('No mandate is granted, so there is nothing to compare.');
  const cli = await readMandateOverCli();
  const compared = {
    'the agent': [cli.mandate.agent, state.mandateAgent],
    'the token': [cli.mandate.asset, state.mandateAsset],
    'the per-transfer limit': [cli.mandate.maxTransactionValue, state.maxTransactionValue],
    'the total limit': [cli.mandate.maxCumulativeValue, state.maxCumulativeValue],
    'the amount spent': [cli.mandate.cumulativeUsed, state.cumulativeUsed],
  };
  for (const [what, [told, read]] of Object.entries(compared)) {
    if (String(told).toLowerCase() !== String(read).toLowerCase())
      throw new Error(`Brickken report ${what} as ${told}, and the test network reads ${read}.`);
  }
  if (cli.mandate.revoked !== state.mandateRevoked)
    throw new Error('Brickken and the test network disagree about whether the mandate is revoked.');
  if (cli.frozen !== state.agentFrozen)
    throw new Error('Brickken and the test network disagree about whether the agent is frozen.');
  const spent = BigInt(cli.mandate.cumulativeUsed) / 10n ** BigInt(SUNL_DECIMALS);
  return `Their tool and the chain agree, at ${spent} ${SUNL_SYMBOL} spent.`;
};

const confirmInstalledSkill = async () => {
  const { confirmSkill } = await import('../dist/brickken/skill.js');
  const installed = confirmSkill();
  const named = installed.declares['name'] ?? installed.artifact;
  const day = installed.at.slice(0, 10);
  return `The ${named} skill is installed, ${installed.files.length} files, unchanged since ${day}.`;
};

const confirmSurfaces = async () => {
  const { readFileSync } = await import('node:fs');
  const { SURFACES_FILE, declaration, render } = await import('../dist/surfaces.js');
  const found = declaration();
  if (readFileSync(SURFACES_FILE, 'utf8') !== render(found))
    throw new Error('SURFACES.md is not what the evidence says. Run npm run surfaces.');
  const used = found.sections.filter((section) => section.methods.length > 0);
  const methods = used.reduce((total, section) => total + section.methods.length, 0);
  const surfaces = used.length + (found.skill === null ? 0 : 1);
  return `${surfaces} surfaces and ${methods} methods, all read back from the evidence.`;
};

const confirmCapTable = async () => {
  const { composeCapTable } = await import('../dist/captable.js');
  const { SUNL_DECIMALS, SUNL_SYMBOL } = await import('../dist/shared/config.js');
  const table = await composeCapTable();
  if (table.disagreements.length > 0) throw new Error(table.disagreements.join('. '));
  const unit = 10n ** BigInt(SUNL_DECIMALS);
  const held = table.rows.map((row) => `${row.label} ${row.onChain / unit}`).join(', ');
  const issued = table.supply / unit;
  return `At block ${table.block}: ${held}, of ${issued} ${SUNL_SYMBOL} issued.`;
};

export const RUNNERS = {
  ...PAGE_RUNNERS,
  ...REFUSAL_RUNNERS,
  surfaces: confirmSurfaces,
  captable: confirmCapTable,
  skill: confirmInstalledSkill,
  readings: confirmReadings,
  allowance: confirmAllowance,
  holding: confirmHolding,
  allowed: confirmAllowed,
  chain: readLatestBlock,
  eligibility: confirmEligibility,
  recorder: confirmRecorder,
  mandate: confirmMandate,
  moved: confirmMoved,
  keeper: confirmKeeper,
  wallets: confirmWallets,
  asset: confirmAsset,
  record: confirmRecord,
};
