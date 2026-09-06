import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const EVIDENCE = join(import.meta.dirname, '..', 'evidence');

const evidenceFiles = () => readdirSync(EVIDENCE).filter((name) => name.endsWith('.jsonl'));

const recordsIn = (name) =>
  readFileSync(join(EVIDENCE, name), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line));

const confirmVenues = async () => {
  const { checkVenue } = await import('../dist/chain/venue.js');
  const counted = { registry: 0, lab: 0 };
  for (const name of evidenceFiles()) {
    for (const record of recordsIn(name)) counted[checkVenue(record)] += 1;
  }
  if (counted.lab === 0) throw new Error('No record is filed against our own deployment at all.');
  return `${counted.registry + counted.lab} records read, ${counted.lab} from our own copies and ${counted.registry} from theirs, and none of them names an address belonging to the other.`;
};

const confirmDifferential = async () => {
  const { LAYERS_FILE, differential, layers } = await import('../dist/layers.js');
  const current = readFileSync(LAYERS_FILE, 'utf8');
  if (current !== layers())
    throw new Error('LAYERS.md and the evidence behind it disagree. Run npm run layers.');
  const { lab } = differential();
  const open = lab.filter((row) => row.refusedBy === 'nothing');
  const [first] = open;
  if (first === undefined)
    throw new Error('Every configuration was refused, so nothing was shown.');
  const whole = (base) => String(BigInt(base) / 10n ** BigInt(first.decimals));
  return `${String(lab.length)} configurations were measured and ${String(open.length)} of them were refused by nothing at all. In the first of those, ${whole(first.put)} tokens were put to the executor, ${whole(first.moved)} moved to an address the permission never names, and the registry counted ${whole(first.cumulativeUsed)} against the limit as ordinary use of it.`;
};

const confirmNothingSent = async () => {
  const { ANCHOR_FILE } = await import('../dist/chain/anchors.js');
  const { BATTERY_FILE } = await import('../dist/chain/battery.js');
  const { readRecords } = await import('../dist/shared/jsonl.js');
  const sent = [...readRecords(ANCHOR_FILE), ...readRecords(BATTERY_FILE)];
  const fromLab = sent.filter((record) => record.venue === 'lab');
  if (fromLab.length > 0)
    throw new Error(`${String(fromLab.length)} transactions were sent from our own deployment.`);
  const hashes = sent.filter((record) => record.transactionHash !== null).length;
  return `All ${String(hashes)} transactions this project has ever sent went to the shared network, and none of them came from the adversarial work. That work is held in files that carry no transaction hash at all, because it was never sent anywhere.`;
};

const confirmEvidencePage = async () => {
  const { EVIDENCE_DOC, evidence, hashesIn, proof } = await import('../dist/evidence.js');
  const page = readFileSync(EVIDENCE_DOC, 'utf8');
  if (page !== evidence())
    throw new Error('EVIDENCE.md and the records behind it disagree. Run npm run evidence.');
  const hashes = hashesIn(proof());
  const missing = hashes.filter((hash) => !page.includes(hash));
  if (missing.length > 0)
    throw new Error(`${String(missing.length)} transactions are recorded but not on the page.`);
  return `${String(hashes.length)} transactions are on the page, every one linked to where anybody can open it, and not one recorded transaction is left off.`;
};

export const LAB_RUNNERS = {
  evidencePage: confirmEvidencePage,
  venues: confirmVenues,
  differential: confirmDifferential,
  nothingSent: confirmNothingSent,
};
