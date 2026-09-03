import type { CapTable } from '../captable.js';
import { ANCHOR_FILE, type Anchor, type AnchorAction } from '../chain/anchors.js';
import { BATTERY_FILE, type BatteryCase, type Layer } from '../chain/battery.js';
import { sunlAmount } from '../chain/mandate.js';
import { REFUSAL_FILE, type Refusal } from '../chain/refusal.js';
import type { RegistryRead } from '../chain/registry.js';
import { SIGNATURE_FILE, type SignatureRecord } from '../chain/signatures.js';
import { mandateInPlainWords } from '../keeper/decide.js';
import { issuerTerms, readDocument, type IssuerRecord } from '../keeper/material.js';
import { POLICY, policyInPlainWords, type Policy } from '../keeper/policy.js';
import {
  SUNL_NAME,
  SUNL_SYMBOL,
  explorerAddress,
  explorerTransaction,
  requireAddress,
} from '../shared/config.js';
import { readRecords } from '../shared/jsonl.js';

const investorHolding = (table: CapTable): bigint | null => {
  const wanted = requireAddress('principal').toLowerCase();
  return table.rows.find((row) => row.wallet.toLowerCase() === wanted)?.onChain ?? null;
};

const holdingLine = (table: CapTable | null): string => {
  const held = table === null ? null : investorHolding(table);
  if (table === null || held === null)
    return `How much ${SUNL_SYMBOL} exists and who holds it are read from the chain, and that read did not answer just now.`;
  return `${sunlAmount(table.supply)} exists in total, and the investor holds ${sunlAmount(held)} of it, read at block ${String(table.block)}.`;
};

export const scenarioInPlainWords = (issuer: IssuerRecord, table: CapTable | null): string[] => [
  `${SUNL_NAME} is an invented hotel. Its shares are the ${SUNL_SYMBOL} token on a test network, and none of it is worth anything.`,
  holdingLine(table),
  `The issuer sells at ${issuer.tokenPrice} ${issuer.acceptedCoin} a token, and that offering ends ${issuer.endDate}.`,
  'Keeper reads an offering document and proposes one action. Whatever it proposes is checked again before anything moves.',
];

export interface EvidenceRow {
  claim: string;
  layer: Layer;
  outcome: 'allowed' | 'refused';
  reason: string | null;
  blockNumber: string;
  transactionHash: `0x${string}`;
  explorer: string;
}

const linked = (row: Omit<EvidenceRow, 'explorer'>): EvidenceRow => ({
  ...row,
  explorer: explorerTransaction(row.transactionHash),
});

/** A claim with no hash was proved by a free read, and this table serves only what ran. */
const sent = (hash: unknown): hash is `0x${string}` => typeof hash === 'string';

const batteryRows = (file: string): EvidenceRow[] =>
  readRecords<BatteryCase>(file).flatMap((record) =>
    sent(record.transactionHash)
      ? [
          linked({
            claim: `an action outside the mandate, refused on ${record.firstFalse ?? 'no clause'}`,
            layer: record.layer,
            outcome: 'refused',
            reason: record.revert?.error ?? null,
            blockNumber: record.blockNumber,
            transactionHash: record.transactionHash,
          }),
        ]
      : [],
  );

/** The record holds the block it read at, and the block a claim names is the one it ran in. */
const refusalRows = (file: string, anchored: Map<string, string>): EvidenceRow[] =>
  readRecords<Refusal>(file).flatMap((record) => {
    if (!sent(record.transactionHash)) return [];
    const blockNumber = anchored.get(record.transactionHash);
    return blockNumber === undefined
      ? []
      : [
          linked({
            claim: `${sunlAmount(BigInt(record.refusedAmount))} asked where ${sunlAmount(BigInt(record.allowedAmount))} is the most one action may move`,
            layer: record.decidedBy,
            outcome: 'refused',
            reason: record.revert.error,
            blockNumber,
            transactionHash: record.transactionHash,
          }),
        ];
  });

const ALLOWED_CLAIM: Readonly<Partial<Record<AnchorAction, string>>> = Object.freeze({
  'agent-action': 'a transfer inside the mandate, signed by the agent and executed',
  'keeper-action': 'a transfer the agent proposed, the guard passed, and the mandate allowed',
});

const anchorRows = (recorded: Anchor[]): EvidenceRow[] =>
  recorded.flatMap((anchor) => {
    const claim = ALLOWED_CLAIM[anchor.action];
    return claim === undefined || anchor.status !== 'success'
      ? []
      : [
          linked({
            claim,
            layer: 'mandate',
            outcome: 'allowed',
            reason: null,
            blockNumber: anchor.blockNumber,
            transactionHash: anchor.transactionHash,
          }),
        ];
  });

/** Refusing to change the authority is a different claim from refusing to spend under it. */
const AUTHORITY_CLAIM: Readonly<Record<string, string>> = Object.freeze({
  D1: 'a signed instruction submitted after its deadline had passed',
  R1: 'a signed instruction that had already been used, submitted a second time',
  X4: 'a second mandate granted on top of one that is still live',
});

export const authorityTable = (file: string = SIGNATURE_FILE): EvidenceRow[] =>
  readRecords<SignatureRecord>(file).flatMap((record) => {
    const claim = AUTHORITY_CLAIM[record.case];
    return claim === undefined || !record.refused || record.revert === null
      ? []
      : [
          linked({
            claim,
            layer: 'mandate',
            outcome: 'refused',
            reason: record.revert.error,
            blockNumber: record.blockNumber,
            transactionHash: record.transactionHash,
          }),
        ];
  });

export interface EvidenceFiles {
  battery?: string;
  anchors?: string;
  refusals?: string;
  signatures?: string;
}

export function evidenceTable({
  battery = BATTERY_FILE,
  anchors = ANCHOR_FILE,
  refusals = REFUSAL_FILE,
}: EvidenceFiles = {}): EvidenceRow[] {
  const recorded = readRecords<Anchor>(anchors);
  const blocks = new Map(recorded.map((anchor) => [anchor.transactionHash, anchor.blockNumber]));
  return [...anchorRows(recorded), ...batteryRows(battery), ...refusalRows(refusals, blocks)].sort(
    (one, other) => Number(BigInt(one.blockNumber) - BigInt(other.blockNumber)),
  );
}

export interface HolderRow {
  label: string;
  wallet: `0x${string}`;
  explorer: string;
  onChain: string;
  reported: string;
  cleared: boolean;
  reportedBy: string;
}

const holderRows = (table: CapTable): HolderRow[] =>
  table.rows.map((row) => ({
    label: row.label,
    wallet: row.wallet,
    explorer: explorerAddress(row.wallet),
    onChain: sunlAmount(row.onChain),
    reported: sunlAmount(row.reported),
    cleared: row.cleared,
    reportedBy: row.reportedBy,
  }));

export interface DemoView {
  scenario: string[];
  document: string;
  mandate: string[];
  policy: string[];
  blockNumber: string;
  holdersRead: boolean;
  holdersAtBlock: string | null;
  holders: HolderRow[];
  disagreements: string[];
  evidence: EvidenceRow[];
  authority: EvidenceRow[];
}

export interface ViewSources {
  state: RegistryRead;
  capTable: CapTable | null;
  document?: string;
  issuer?: IssuerRecord;
  policy?: Policy;
  files?: EvidenceFiles;
}

/** Every line is generated from a record or a read, so nothing here can be typed out by hand. */
export function demoView({
  state,
  capTable,
  document = readDocument(),
  issuer = issuerTerms(),
  policy = POLICY,
  files = {},
}: ViewSources): DemoView {
  return {
    scenario: scenarioInPlainWords(issuer, capTable),
    document,
    mandate: mandateInPlainWords(state),
    policy: policyInPlainWords(policy),
    blockNumber: state.blockNumber,
    holdersRead: capTable !== null,
    holdersAtBlock: capTable === null ? null : String(capTable.block),
    holders: capTable === null ? [] : holderRows(capTable),
    disagreements: capTable?.disagreements ?? [],
    evidence: evidenceTable(files),
    authority: authorityTable(files.signatures),
  };
}
