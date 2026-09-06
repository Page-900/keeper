import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ANCHOR_FILE, type Anchor } from './chain/anchors.js';
import { BATTERY_FILE, type BatteryCase } from './chain/battery.js';
import { SIGNATURE_FILE, type SignatureRecord } from './chain/signatures.js';
import { differential, type Differential } from './layers.js';
import { CHAIN_ID, explorerTransaction } from './shared/config.js';
import { KeeperError } from './shared/errors.js';
import { readRecords } from './shared/jsonl.js';
import { table } from './shared/markdown.js';

export const EVIDENCE_DOC = fileURLToPath(new URL('../EVIDENCE.md', import.meta.url));

export interface EvidenceSources {
  anchors?: string;
  battery?: string;
  signatures?: string;
}

export interface Proof {
  anchors: Anchor[];
  battery: BatteryCase[];
  signatures: SignatureRecord[];
  lab: Differential;
}

const SETUP: readonly [string, string][] = [
  ['deploy-executor', 'The executor contract was deployed'],
  ['register-action', 'The one action it may forward was registered'],
  ['register-second-action', 'A second action was registered and never enabled on any mandate'],
  ['whitelist-holder', 'The investor was cleared to hold the token'],
  ['mint-holding', "The investor's holding was issued"],
  ['approve-executor', 'The investor allowed the executor to move that holding'],
  ['whitelist-counterparty', 'The buyer was cleared to hold the token'],
  ['grant-mandate', 'The investor granted the mandate, signed rather than called directly'],
];

const ISSUANCE: readonly [string, string][] = [
  ['create-token', 'The asset token was created through their issuance API'],
  ['create-rehearsal-token', 'A throwaway token was created first, to rehearse the offering'],
  ['open-rehearsal-offering', 'The offering was rehearsed on that throwaway token'],
  ['open-offering', 'The offering was opened on the asset itself'],
];

const ACTING: readonly [string, string][] = [
  ['agent-action', 'The agent moved value inside the mandate'],
  ['keeper-action', 'The agent reasoned its way to an amount, and that amount went through'],
  ['agent-refusal', 'The same agent, one unit over the limit, refused by the registry'],
  ['fund-counterparty', 'The buyer was funded so it could send the holding back'],
  ['return-holding', 'The buyer returned it, so the demonstration can be run again'],
];

const named = (pairs: readonly [string, string][]): Map<string, string> => new Map(pairs);

const SETUP_NAMES = named(SETUP);
const ISSUANCE_NAMES = named(ISSUANCE);
const ACTING_NAMES = named(ACTING);

const PROBE = 'grant-probe-';

const outcome = (status: Anchor['status']): string =>
  status === 'success' ? 'went through' : '**refused**';

const link = (hash: string): string => `[${hash.slice(0, 10)}…](${explorerTransaction(hash)})`;

const anchorRow = (anchor: Anchor, what: string): string[] => [
  what,
  outcome(anchor.status),
  anchor.blockNumber,
  link(anchor.transactionHash),
];

const firstOf = (anchors: Anchor[], action: string): Anchor | undefined =>
  anchors.find((anchor) => anchor.action === action);

const section = (title: string, lead: string, rows: string[][]): string[] =>
  rows.length === 0
    ? []
    : [
        `## ${title}`,
        '',
        lead,
        '',
        ...table(['What happened', 'Result', 'Block', 'Transaction'], rows),
        '',
      ];

const listed = (anchors: Anchor[], names: Map<string, string>): string[][] =>
  [...names].flatMap(([action, what]) => {
    const anchor = firstOf(anchors, action);
    return anchor === undefined ? [] : [anchorRow(anchor, what)];
  });

const probeRows = (anchors: Anchor[]): string[][] =>
  anchors
    .filter((anchor) => anchor.action.startsWith(PROBE))
    .map((anchor, at) =>
      anchorRow(
        anchor,
        `Probe mandate ${String(at + 1)}, granted with tiny limits and a short window`,
      ),
    );

const CLAUSE: Readonly<Record<string, string>> = Object.freeze({
  asset: 'the asset the mandate names',
  'no mandate': 'there being no mandate at all',
  window: 'the time window',
  revoked: 'the investor having revoked it',
  action: 'the action being one it allows',
  frozen: 'the agent being frozen',
  'per transaction cap': 'the most it may move at once',
  'cumulative cap': 'the most it may move in total',
});

const batteryRow = (record: BatteryCase): string[] => [
  record.case,
  CLAUSE[record.firstFalse ?? ''] ?? 'more than one at once',
  record.revert?.error ?? 'nothing',
  record.blockNumber,
  link(record.transactionHash ?? ''),
];

const signatureRow = (record: SignatureRecord): string[] => [
  record.case,
  record.revert?.error ?? 'nothing',
  record.blockNumber,
  link(record.transactionHash),
];

const shown = (found: Proof): Set<string> =>
  new Set([
    ...[...SETUP_NAMES, ...ISSUANCE_NAMES, ...ACTING_NAMES].flatMap(([action]) => {
      const anchor = firstOf(found.anchors, action);
      return anchor === undefined ? [] : [anchor.transactionHash];
    }),
    ...found.anchors
      .filter((anchor) => anchor.action.startsWith(PROBE))
      .map((anchor) => anchor.transactionHash),
    ...found.battery.map((record) => record.transactionHash ?? ''),
    ...found.signatures.map((record) => record.transactionHash),
  ]);

const OTHERWISE: Readonly<Record<string, string>> = Object.freeze({
  'signature-revoke':
    'A signed revocation, sent legitimately, so its signature could be replayed after',
});

const LEGAL = 'battery-legal-';

const remainder = (found: Proof): string[][] => {
  const already = shown(found);
  return found.anchors
    .filter((anchor) => !already.has(anchor.transactionHash))
    .map((anchor) =>
      anchorRow(
        anchor,
        anchor.action.startsWith(LEGAL)
          ? 'A permitted amount, sent so the running total reaches the limit the next one breaks'
          : (OTHERWISE[anchor.action] ?? anchor.action),
      ),
    );
};

const unique = (anchors: Anchor[]): Anchor[] => {
  const seen = new Set<string>();
  return anchors.filter((anchor) => {
    const key = `${anchor.action}:${anchor.transactionHash}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const proof = ({
  anchors = ANCHOR_FILE,
  battery = BATTERY_FILE,
  signatures = SIGNATURE_FILE,
}: EvidenceSources = {}): Proof => {
  const read = unique(readRecords<Anchor>(anchors));
  if (read.length === 0)
    throw new KeeperError('refusalUnattributable', `no transactions recorded in ${anchors}`);
  return {
    anchors: read,
    battery: readRecords<BatteryCase>(battery),
    signatures: readRecords<SignatureRecord>(signatures).filter((record) => record.refused),
    lab: differential(),
  };
};

/** Every hash the evidence holds must appear in the page, so nothing can be quietly left out. */
export const hashesIn = (found: Proof): string[] =>
  [
    ...found.anchors.map((anchor) => anchor.transactionHash),
    ...found.battery.map((record) => record.transactionHash ?? ''),
    ...found.signatures.map((record) => record.transactionHash),
  ].filter((hash) => hash !== '');

const labLines = (found: Proof): string[] => {
  const open = found.lab.lab.filter((row) => row.refusedBy === 'nothing');
  return [
    '## Measured off the shared network',
    '',
    `Everything above was sent to Sepolia and can be opened. The genuinely adversarial work was not, and that was a deliberate line rather than an omission. A wrongly configured gate, and a delivery that no limit refuses, were measured on copies of the published contracts that this repository deploys inside its own tests. ${String(found.lab.lab.length)} configurations were measured and ${String(open.length)} of them were refused by nothing at all.`,
    '',
    'Those results carry no transaction hash, because nothing was sent. They are reproducible instead: `npm run ci` runs them on a fresh clone with no key and no network, in seconds. `LAYERS.md` holds the table and says what each row does and does not prove.',
    '',
  ];
};

const NOT_MEASURED = [
  '## What is not measured, said plainly',
  '',
  'Two things this project intended to measure were not built, and the honest thing is to name them rather than let the tables imply otherwise.',
  '',
  '**The delay between a compliance record being revoked and the agent being frozen is not measured.** The standard names this risk and does not size it, and sizing it would have been the most useful number here. What is established instead, by reading the registry, is that it is not a race in the ordering sense: the permission check never reads the compliance provider at all, so a revocation and an action can sit in the same block and the action still passes.',
  '',
  '**Whether one agent serving two investors can be talked into acting against the second is not tested.** The on-chain half is readable from the reference implementation, which keys a mandate to the pair of agent and investor and checks only the acting investor, so the limits are separate by construction. That is a reading of code and is not written here as a test result.',
  '',
];

export const render = (found: Proof): string =>
  [
    '# What was actually run, and where',
    '',
    `Generated from the records this repository captured at the moment each call was made, never written from memory. Regenerate with \`npm run evidence\`. A test fails if this file and those records disagree, and a second one fails if a single recorded transaction is missing from it.`,
    '',
    `Everything below is on Ethereum Sepolia, chain ${String(CHAIN_ID)}. Every hash links to Etherscan.`,
    '',
    ...section(
      'Issuing the asset',
      'The token and its offering, through their issuance API rather than by hand.',
      listed(found.anchors, ISSUANCE_NAMES),
    ),
    ...section(
      'Setting up the mandate',
      'What had to exist before an agent could act at all.',
      listed(found.anchors, SETUP_NAMES),
    ),
    ...section(
      'The agent acting under it',
      'The two that matter are the last two: value moving inside the limit, and the identical call one unit over it.',
      listed(found.anchors, ACTING_NAMES),
    ),
    ...section(
      'The probe mandates',
      "Every refusal below was run against a separate mandate with tiny limits, so the battery never spent the investor's own lifetime allowance.",
      probeRows(found.anchors),
    ),
    '## Every limit refusing, one at a time',
    '',
    '**These all revert with the same error, so the revert cannot say which limit was broken.** The registry answers one boolean and the executor turns any false into one error. What names the limit is a read of the mandate state at that same block, which is recorded beside each case and re-checked against the chain. A refusal that could not be pinned to a single limit is recorded as such rather than credited to one.',
    '',
    ...table(
      ['Case', 'The first limit it broke', 'Revert', 'Block', 'Transaction'],
      found.battery.map(batteryRow),
    ),
    '',
    '## Signed instructions the registry refused',
    '',
    'A signature already spent, one whose deadline had passed, and an attempt to grant a second mandate on top of a live one. These three do name their own reason, because they are refused before the single boolean is ever reached.',
    '',
    ...table(['Case', 'Revert', 'Block', 'Transaction'], found.signatures.map(signatureRow)),
    '',
    ...section(
      'Everything else that was sent',
      'Listed so that no transaction this project ever sent is missing from this page.',
      remainder(found),
    ),
    ...labLines(found),
    ...NOT_MEASURED,
  ].join('\n');

export const evidence = (sources: EvidenceSources = {}): string => render(proof(sources));

export function writeEvidence(file: string = EVIDENCE_DOC, sources: EvidenceSources = {}): string {
  const text = evidence(sources);
  writeFileSync(file, text, 'utf8');
  return text;
}
