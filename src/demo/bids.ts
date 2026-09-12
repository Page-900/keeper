import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUNL_DECIMALS, asAddress } from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';

export const BIDS_DIRECTORY = fileURLToPath(new URL('../../material/bids/', import.meta.url));

export interface Bid {
  id: string;
  title: string;
  says: string;
  document: string;
}

const TITLE = /^# (.+)$/;
const SAYS = /^> (.+)$/;

/** A bid is one file, so the words a visitor reads and the words the agent reads cannot drift. */
export function readBid(text: string, id: string): Bid {
  const lines = text.split('\n');
  const titleAt = lines.findIndex((line) => TITLE.test(line));
  const saysAt = lines.findIndex((line) => SAYS.test(line));
  if (titleAt === -1 || saysAt === -1)
    throw new KeeperError('bidUnreadable', `${id} does not open with a title and a summary`);
  return {
    id,
    title: TITLE.exec(lines[titleAt] ?? '')?.[1] ?? '',
    says: SAYS.exec(lines[saysAt] ?? '')?.[1] ?? '',
    document: lines
      .slice(saysAt + 1)
      .join('\n')
      .trim(),
  };
}

export const listBids = (directory: string = BIDS_DIRECTORY): Bid[] =>
  readdirSync(directory)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => readBid(readFileSync(join(directory, name), 'utf8'), name.replace('.md', '')));

export interface BidTerms {
  buying: bigint;
  pricePerToken: bigint;
  partialFill: boolean;
  settlesTo: `0x${string}` | null;
}

const ROW = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/;

const unreadable = (why: string): never => {
  throw new KeeperError('bidUnreadable', why);
};

const termRows = (document: string): Record<string, string> =>
  Object.fromEntries(
    document
      .split('\n')
      .map((line) => ROW.exec(line))
      .filter((found): found is RegExpExecArray => found !== null)
      .map((found) => [(found[1] ?? '').toLowerCase(), found[2] ?? '']),
  );

const row = (rows: Record<string, string>, label: string): string =>
  rows[label] ?? unreadable(`no ${label} row`);

const firstNumber = (value: string, label: string): bigint => {
  const digits = /\d[\d,]*/.exec(value);
  return digits === null
    ? unreadable(`no number in the ${label} row`)
    : BigInt(digits[0].replaceAll(',', ''));
};

export function bidTerms(document: string): BidTerms {
  const rows = termRows(document);
  const settlement = row(rows, 'settlement');
  return {
    buying: firstNumber(row(rows, 'buying'), 'buying') * 10n ** BigInt(SUNL_DECIMALS),
    pricePerToken: firstNumber(row(rows, 'price offered'), 'price offered'),
    partialFill: row(rows, 'partial fill').toLowerCase() === 'welcome',
    settlesTo: asAddress(settlement.replace(/^to\s+/i, '')),
  };
}
