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

const confirmRefusal = async () => {
  const { proveRefusal } = await import('../dist/chain/refusal.js');
  const { sunlAmount } = await import('../dist/chain/mandate.js');
  const { allowedAmount, refusedAmount, revert } = await proveRefusal();
  return `${sunlAmount(BigInt(allowedAmount))} passes, ${sunlAmount(BigInt(refusedAmount))} is refused with ${revert.error}.`;
};

const confirmRefusalSent = async () => {
  const { readRecords } = await import('../dist/shared/jsonl.js');
  const { ANCHOR_FILE } = await import('../dist/chain/anchors.js');
  const { transactionReceipt } = await import('../dist/chain/client.js');
  const sent = readRecords(ANCHOR_FILE)
    .filter((anchor) => anchor.action === 'agent-refusal')
    .pop();
  if (sent === undefined) throw new Error('No refused transfer has been sent yet.');
  const receipt = await transactionReceipt(sent.transactionHash);
  if (receipt.status !== 'reverted')
    throw new Error(`${sent.transactionHash} is ${receipt.status} on the chain, not reverted.`);
  if (String(receipt.gasUsed) !== sent.gasUsed)
    throw new Error(
      `${sent.transactionHash} used ${receipt.gasUsed} gas, and the record says ${sent.gasUsed}.`,
    );
  return `${sent.transactionHash} reverted in block ${sent.blockNumber}, using ${sent.gasUsed} gas.`;
};

const stillReverted = async (records, what) => {
  const { transactionReceipt } = await import('../dist/chain/client.js');
  for (const record of records) {
    const receipt = await transactionReceipt(record.transactionHash);
    if (receipt.status !== 'reverted')
      throw new Error(
        `${what} ${record.case} reads as ${receipt.status} on the chain, not reverted.`,
      );
  }
};

const confirmBattery = async () => {
  const { readRecords } = await import('../dist/shared/jsonl.js');
  const { ANCHORED_CLAUSES, BATTERY_FILE, isolated, provedClauses, unanchoredClauses } =
    await import('../dist/chain/battery.js');
  const records = readRecords(BATTERY_FILE);
  const proved = provedClauses(records);
  const missing = ANCHORED_CLAUSES.filter((clause) => !proved.includes(clause));
  if (missing.length > 0) throw new Error(`No refusal is recorded for: ${missing.join(', ')}.`);
  const extra = proved.filter((clause) => !ANCHORED_CLAUSES.includes(clause));
  if (extra.length > 0)
    throw new Error(`A refusal is recorded for an unlisted rule: ${extra.join(', ')}.`);
  await stillReverted(records, 'The recorded refusal');
  const alone = records.filter((record) => isolated(record)).map((record) => record.case);
  const ordered = records.filter((record) => !isolated(record)).map((record) => record.case);
  const left = unanchoredClauses();
  const also =
    ordered.length === 0
      ? ''
      : ` ${ordered.join(', ')} broke more than one rule at once, so the rule named for each is the one the contract tests first and not the only one that failed.`;
  return `${records.length} refusals on the chain, covering ${proved.length} of the registry's rules: ${proved.join(', ')}. ${alone.join(', ')} each broke exactly one rule.${also} The other ${left.length} rules (${left.join(' and ')}) cannot be sent from here: freezing an agent needs a role only Brickken hold, and having no permission at all is always reported as the wrong asset instead.`;
};

const confirmSecondAction = async () => {
  const { readRegistryState } = await import('../dist/chain/registry.js');
  const { SECOND_ACTION, SECOND_ACTION_ID } = await import('../dist/shared/config.js');
  const state = await readRegistryState({ action: SECOND_ACTION_ID });
  if (state.actionEnabled)
    throw new Error(
      `The mandate enables ${SECOND_ACTION.signature}, which no mandate ever should.`,
    );
  return `The executor forwards ${SECOND_ACTION.signature} and no mandate enables it, read off the chain at block ${state.blockNumber}.`;
};

const confirmSignatureRefusals = async () => {
  const { readRecords } = await import('../dist/shared/jsonl.js');
  const { REFUSALS, SIGNATURE_FILE } = await import('../dist/chain/signatures.js');
  const records = readRecords(SIGNATURE_FILE);
  const refusals = records.filter((record) => record.refused);
  for (const [name, error] of Object.entries(REFUSALS)) {
    const found = refusals.find((record) => record.case === name);
    if (found === undefined) throw new Error(`No refusal is recorded for ${name}.`);
    if (found.revert.error !== error)
      throw new Error(`${name} is recorded as ${found.revert.error} and should be ${error}.`);
  }
  const replay = refusals.find((record) => record.case === 'R1');
  if (replay.nonceSigned === replay.nonceBefore)
    throw new Error(
      `R1 was submitted at replay number ${replay.nonceBefore}, the one it was signed at.`,
    );
  await stillReverted(refusals, 'The recorded refusal');
  return `${refusals.length} refusals on the chain. A signature already spent at replay number ${replay.nonceSigned} was refused when it was submitted again at ${replay.nonceBefore}, one carrying a past deadline was refused before it was even read, and a second permission on top of a live one was refused before the signature was looked at.`;
};

const confirmWindow = async () => {
  const { KEEPER_MANDATE, MANDATE_MUST_HOLD_UNTIL, MANDATE_MUST_HOLD_UNTIL_ISO, specWindow } =
    await import('../dist/shared/config.js');
  const state = await registryState();
  const subject = state.mandateGranted ? 'The granted mandate' : 'A mandate granted now';
  const endsAt = state.mandateGranted
    ? BigInt(state.mandateValidUntil)
    : BigInt(specWindow(KEEPER_MANDATE, Math.floor(Date.now() / 1000)).validUntil);
  const readable = new Date(Number(endsAt) * 1000).toISOString();
  if (endsAt <= MANDATE_MUST_HOLD_UNTIL)
    throw new Error(`${subject} ends at ${readable}, before ${MANDATE_MUST_HOLD_UNTIL_ISO}.`);
  return `${subject} runs to ${readable}, past ${MANDATE_MUST_HOLD_UNTIL_ISO}.`;
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
  refusal: confirmRefusal,
  refused: confirmRefusalSent,
  battery: confirmBattery,
  secondAction: confirmSecondAction,
  signatures: confirmSignatureRefusals,
  window: confirmWindow,
  wallets: confirmWallets,
  asset: confirmAsset,
  record: confirmRecord,
};
