import {
  SUNL_DECIMALS,
  SUNL_NAME,
  SUNL_SUPPLY_WHOLE,
  SUNL_SYMBOL,
  SUNL_TOKEN_TYPE,
} from './config.js';

export type AssetClass = typeof SUNL_TOKEN_TYPE;

export interface TokenSpec {
  name: string;
  symbol: string;
  tokenType: AssetClass;
  supplyWhole: bigint;
}

export const SUNL: TokenSpec = Object.freeze({
  name: SUNL_NAME,
  symbol: SUNL_SYMBOL,
  tokenType: SUNL_TOKEN_TYPE,
  supplyWhole: SUNL_SUPPLY_WHOLE,
});

/** Disposable, so an irreversible answer is never learned on the asset the mandate names. */
export const REHEARSAL: TokenSpec = Object.freeze({
  name: 'Keeper Rehearsal',
  symbol: 'KPRH',
  tokenType: SUNL_TOKEN_TYPE,
  supplyWhole: 10_000n,
});

export const supplyInBaseUnits = (spec: TokenSpec): bigint =>
  spec.supplyWhole * 10n ** BigInt(SUNL_DECIMALS);
