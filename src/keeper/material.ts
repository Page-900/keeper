import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SUNL_SYMBOL } from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { readRecords } from '../shared/jsonl.js';

export const DOCUMENT_FILE = fileURLToPath(
  new URL('../../material/sunrise-lodge.md', import.meta.url),
);

const OPENS_FILE = fileURLToPath(new URL('../../evidence/offering-opens.jsonl', import.meta.url));

export interface IssuerRecord {
  symbol: string;
  name: string;
  tokenPrice: string;
  acceptedCoin: string;
  startDate: string;
  endDate: string;
}

/** The issuer's own terms come from the issuer's record, so our prose cannot contradict them. */
export function issuerTerms(file: string = OPENS_FILE, symbol: string = SUNL_SYMBOL): IssuerRecord {
  const found = readRecords<IssuerRecord>(file)
    .filter((record) => record.symbol === symbol)
    .at(-1);
  if (found === undefined)
    throw new KeeperError('brickkenUnreadable', `no offering recorded for ${symbol}`);
  return found;
}

export const readDocument = (file: string = DOCUMENT_FILE): string => readFileSync(file, 'utf8');

export interface Material {
  document: string;
  issuer: IssuerRecord;
}

export const gatherMaterial = (
  document: string = readDocument(),
  issuer: IssuerRecord = issuerTerms(),
): Material => ({ document, issuer });
