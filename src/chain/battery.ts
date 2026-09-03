import { fileURLToPath } from 'node:url';

import { CHAIN_ID } from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { appendRecord } from '../shared/jsonl.js';
import type { RevertReason } from './client.js';
import { CLAUSES, type Clause, type ClauseResult } from './differential.js';
import type { RegistryRead } from './registry.js';

/** Resolved from this module, so the file cannot follow the working directory. */
export const BATTERY_FILE = fileURLToPath(new URL('../../evidence/battery.jsonl', import.meta.url));

export type Layer = 'token' | 'mandate' | 'app';

export interface BatteryCase {
  at: string;
  chainId: number;
  case: string;
  layer: Layer;
  blockNumber: string;
  transactionHash: `0x${string}` | null;
  revert: RevertReason | null;
  firstFalse: Clause | null;
  clauses: ClauseResult[];
  agreedWithChain: boolean;
  state: RegistryRead;
}

export type BatteryClaim = Omit<BatteryCase, 'at' | 'chainId'>;

const refuse = (why: string): never => {
  throw new KeeperError('refusalUnattributable', why);
};

/** CannotExecute is the mandate refusing. CallFailed is the target refusing. */
const LAYER_REVERT: Readonly<Record<Layer, string | null>> = Object.freeze({
  token: 'CallFailed',
  mandate: 'CannotExecute',
  app: null,
});

export function requireLayerRevert(name: string, layer: Layer, revert: RevertReason | null): void {
  const expected = LAYER_REVERT[layer];
  if (revert === null) {
    if (expected !== null) refuse(`${name} is credited to the ${layer} layer and nothing reverted`);
    return;
  }
  if (revert.error !== expected)
    refuse(`${name} is credited to the ${layer} layer and reverted ${revert.error}`);
}

/** An unattributed block is not reportable, so the shape refuses one before it is written. */
function requireAttribution(claim: BatteryClaim): void {
  if (claim.case === '') refuse('a case with no name proves nothing');
  if (!claim.agreedWithChain)
    refuse(`${claim.case} was read differently by our reader and by the chain`);

  if (claim.layer === 'mandate' && claim.firstFalse === null)
    refuse(`${claim.case} is credited to the mandate without naming the clause that was false`);

  if (claim.layer === 'token' && claim.firstFalse !== null)
    refuse(
      `${claim.case} is credited to the token, but the mandate refused it first on ${claim.firstFalse}`,
    );

  requireLayerRevert(claim.case, claim.layer, claim.revert);
}

export function recordCase(file: string, claim: BatteryClaim): BatteryCase {
  requireAttribution(claim);
  const record: BatteryCase = { at: new Date().toISOString(), chainId: CHAIN_ID, ...claim };
  appendRecord(file, record);
  return record;
}

/** Frozen needs a role only Brickken hold. No mandate is unreachable: asset is tested first. */
export const ANCHORED_CLAUSES: readonly Clause[] = Object.freeze([
  'asset',
  'window',
  'revoked',
  'action',
  'per transaction cap',
  'cumulative cap',
]);

export const provedClauses = (records: BatteryCase[]): Clause[] => {
  const proved = new Set(records.map((record) => record.firstFalse));
  return CLAUSES.filter((clause) => proved.has(clause));
};

export const failedClauses = (record: BatteryCase): Clause[] =>
  record.clauses.filter((result) => !result.passed).map((result) => result.clause);

/** One failing clause stands alone. More, and the contract's order is what names it. */
export const isolated = (record: BatteryCase): boolean => failedClauses(record).length === 1;

export const unanchoredClauses = (): Clause[] =>
  CLAUSES.filter((clause) => !ANCHORED_CLAUSES.includes(clause));
