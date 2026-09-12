import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    throw new KeeperError('brickkenUnreadable', `${id} does not open with a title and a summary`);
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
