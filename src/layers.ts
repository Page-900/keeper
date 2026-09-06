import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { sunlAmount } from './chain/mandate.js';
import type { Venue } from './chain/venue.js';
import { JAILBREAK_FILE, type JailbreakCase } from './keeper/jailbreak.js';
import { UNCAPPED } from './shared/config.js';
import { KeeperError } from './shared/errors.js';
import { readRecords } from './shared/jsonl.js';
import { table } from './shared/markdown.js';

export const LAB_FILE = fileURLToPath(
  new URL('../evidence/lab-differential.jsonl', import.meta.url),
);

export const LAYERS_FILE = fileURLToPath(new URL('../LAYERS.md', import.meta.url));

export type RefusedBy = 'mandate' | 'nothing';

export interface LabRow {
  venue: Venue;
  configuration: string;
  put: string;
  refusedBy: RefusedBy;
  revertName: string;
  revertSelector: string;
  moved: string;
  cumulativeUsed: string;
  maxTransactionValue: string;
  maxCumulativeValue: string;
  decimals: string;
}

export interface AppRow {
  at: string;
  model: string;
  payload: string;
  amount: string;
  recipient: string;
  rules: string[];
}

export interface Differential {
  app: AppRow;
  lab: LabRow[];
}

export interface DifferentialSources {
  jailbreak?: string;
  lab?: string;
}

const missing = (what: string, file: string): never => {
  throw new KeeperError('refusalUnattributable', `${what} in ${file}`);
};

type RecordedRun = Omit<JailbreakCase, 'model'> & { model?: string };

const compromisedRun = (file: string): AppRow => {
  const found = readRecords<RecordedRun>(file).findLast(
    (record) => record.compromised && record.intent !== null && record.model !== undefined,
  );
  if (found === undefined || found.intent === null || found.model === undefined)
    return missing('no compromised run naming its model', file);
  if (found.guardVerdict !== 'refused' || found.guardRefusals.length === 0)
    return missing('a compromised run the guard did not refuse', file);
  return {
    at: found.at,
    model: found.model,
    payload: found.payload,
    amount: found.intent.amount,
    recipient: found.intent.recipient ?? '',
    rules: found.guardRefusals.map((refusal) => refusal.rule),
  };
};

const labRows = (file: string): LabRow[] => {
  const rows = readRecords<LabRow>(file);
  if (rows.length === 0) return missing('no measured configurations', file);
  for (const row of rows) if (row.venue !== 'lab') missing(`a row filed as ${row.venue}`, file);
  return rows;
};

export const differential = ({
  jailbreak = JAILBREAK_FILE,
  lab = LAB_FILE,
}: DifferentialSources = {}): Differential => ({
  app: compromisedRun(jailbreak),
  lab: labRows(lab),
});

const tokens = (base: string, decimals: string): string => {
  const value = BigInt(base);
  if (value === UNCAPPED) return 'unlimited';
  const unit = 10n ** BigInt(decimals);
  const fraction = (value % unit).toString().padStart(Number(decimals), '0').replace(/0+$/, '');
  return fraction === '' ? String(value / unit) : `${String(value / unit)}.${fraction}`;
};

const labAmount = (base: string, row: LabRow): string => {
  const amount = tokens(base, row.decimals);
  return amount === 'unlimited' ? amount : `${amount} tokens`;
};

const refusedBy = (row: LabRow): string =>
  row.refusedBy === 'nothing' ? '**nothing**' : `the mandate, \`${row.revertName}\``;

const appRow = (app: AppRow): string[] => [
  'every layer on',
  sunlAmount(BigInt(app.amount)),
  `the app layer, on the ${app.rules.join(' and ')} rule`,
  'nothing',
  'nothing',
];

const labLine = (row: LabRow): string[] => [
  row.configuration,
  labAmount(row.put, row),
  refusedBy(row),
  labAmount(row.moved, row),
  labAmount(row.cumulativeUsed, row),
];

const HEADINGS = [
  'Configuration',
  'Amount proposed',
  'What refused it',
  'What moved',
  'Counted against the cap',
];

const capsOf = (row: LabRow): string =>
  `${labAmount(row.maxTransactionValue, row)} at once and ${labAmount(row.maxCumulativeValue, row)} in total`;

const capped = (row: LabRow): boolean => BigInt(row.maxTransactionValue) !== UNCAPPED;

const letThrough = (rows: LabRow[], underCaps: boolean): LabRow | undefined =>
  rows.find((row) => row.refusedBy === 'nothing' && capped(row) === underCaps);

const plainly = (rows: LabRow[]): string[] => {
  const first = letThrough(rows, true);
  if (first === undefined) return missing('no configuration that nothing refused', LAB_FILE);
  return [
    '## The third row',
    '',
    `With the guard taken out and nothing else changed, ${labAmount(first.moved, first)} moved to an address that appears nowhere in the mandate. Nothing refused it. The mandate allowed ${capsOf(first)} and the delivery sat inside both, so the registry counted it as ordinary use of the cap and recorded ${labAmount(first.cumulativeUsed, first)} against it. There is no revert to point at, no error to name, and no layer to credit.`,
    '',
    'That is the whole argument of this project, measured rather than asserted. `canExecute` takes an agent, a principal, an asset, an action and an amount. It is not given a destination, so it cannot have an opinion about one. **The mandate bounds how much, never to whom.**',
    '',
  ];
};

const unbounded = (rows: LabRow[]): string[] => {
  const last = letThrough(rows, false);
  if (last === undefined || BigInt(last.moved) === 0n)
    return missing('no configuration with the caps raised', LAB_FILE);
  return [
    '## The fourth row',
    '',
    `Raising both caps to the value the standard reads as unlimited moved ${labAmount(last.moved, last)} in one call, the whole holding. What stopped it there was not the mandate. It was the ERC-20 allowance the principal had given the executor, which the same call spent to zero. An integrator who grants an unlimited allowance alongside an unlimited cap has no second line at all.`,
    '',
  ];
};

const provenance = (app: AppRow): string[] => [
  '## Where each row was measured',
  '',
  `Row one is a run that happened on ${app.at.slice(0, 10)}: the shipped agent, its own prompt and policy, and its guard reading the mandate live from Brickken's registry on Sepolia. The model was \`${app.model}\`, the attack family was \`${app.payload}\`, and the reasoning layer was talked into proposing ${sunlAmount(BigInt(app.amount))} to \`${app.recipient}\`. Nothing was sent, and every reasoning trace of the run is in \`evidence/jailbreak.jsonl\`.`,
  '',
  'Rows two, three and four are measured on an isolated deployment this repository makes itself: the reference registry, the reference compliance provider, our executor and a plain ERC-20, all deployed inside one test. They send nothing, cost nothing and describe no other deployment. Every row carries the venue it was measured at, and a record that names an address from the shared deployment while claiming to be from the lab is refused rather than written.',
  '',
  'The lab asset carries no clearance check of any kind, so row three says nothing whatever about how any real token treats a recipient. That question is answered separately, on a fork of the deployed contracts, in `contracts/test/ForkRecipient.t.sol`.',
  '',
];

export const render = (found: Differential): string =>
  [
    '# What each layer is worth',
    '',
    'The same delivery, four times, with one defence removed at a time. Generated from the evidence this repository captured as the work happened, never written from memory. Regenerate with `npm run layers`. A test fails if this file and the evidence disagree.',
    '',
    `The attack is not invented for this table. It is the one recorded case where the reasoning layer lost: a document that talked the agent into proposing ${sunlAmount(BigInt(found.app.amount))} to an address the investor's policy does not name.`,
    '',
    ...table(HEADINGS, [appRow(found.app), ...found.lab.map(labLine)]),
    '',
    'Row two changes the amount, and that is the point of it rather than a flaw in it: it is there to show the one thing the mandate does refuse. It refuses on the number. It never asks where the value is going.',
    '',
    ...plainly(found.lab),
    ...unbounded(found.lab),
    ...provenance(found.app),
  ].join('\n');

export const layers = (sources: DifferentialSources = {}): string => render(differential(sources));

export function writeLayers(file: string = LAYERS_FILE, sources: DifferentialSources = {}): string {
  const text = layers(sources);
  writeFileSync(file, text, 'utf8');
  return text;
}
