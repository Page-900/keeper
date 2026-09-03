import { registryState } from './registry-state.js';

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

const confirmRecipient = async () => {
  const { agentActionRefusal } = await import('../dist/chain/action.js');
  const { blockNumber } = await import('../dist/chain/client.js');
  const { MAX_TRANSACTION_VALUE, requireAddress } = await import('../dist/shared/config.js');
  const at = await blockNumber();
  const ask = (name, amount) => agentActionRefusal({ to: requireAddress(name), amount }, at);

  const named = 'counterparty';
  const uncleared = 'uncleared';
  for (const name of [named, uncleared]) {
    const refusal = await ask(name, MAX_TRANSACTION_VALUE);
    if (refusal !== null)
      throw new Error(
        `A delivery to the ${name} address was refused with ${refusal.error}, so the recipient is no longer the thing that makes no difference.`,
      );
  }

  const overCap = await ask(named, MAX_TRANSACTION_VALUE + 1n);
  if (overCap === null)
    throw new Error('One unit above the limit was not refused, so this reading cannot say no.');

  return `At block ${at} the same delivery is allowed to ${requireAddress(named)}, the address the investor named, and to ${requireAddress(uncleared)}, which nobody ever cleared. One unit above the limit is still refused with ${overCap.error}. Nothing was sent.`;
};

export const REFUSAL_RUNNERS = {
  refusal: confirmRefusal,
  refused: confirmRefusalSent,
  battery: confirmBattery,
  secondAction: confirmSecondAction,
  signatures: confirmSignatureRefusals,
  window: confirmWindow,
  recipient: confirmRecipient,
};
