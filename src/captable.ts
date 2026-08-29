import { fileURLToPath } from 'node:url';

import { blockNumber, readTokenBalance, readTokenSupply } from './chain/client.js';
import { createBrickkenClient, type BrickkenClient } from './brickken/client.js';
import {
  COUNTERPARTY_EMAIL,
  HOLDER_EMAIL,
  SUNL_SYMBOL,
  requireAddress,
  type AddressName,
} from './shared/config.js';
import { appendRecord } from './shared/jsonl.js';

export const CAP_TABLE_FILE = fileURLToPath(
  new URL('../evidence/cap-table.jsonl', import.meta.url),
);

interface Identity {
  label: string;
  email: string;
  wallet: AddressName;
}

const IDENTITIES: readonly Identity[] = Object.freeze([
  { label: 'investor', email: HOLDER_EMAIL, wallet: 'principal' },
  { label: 'counterparty', email: COUNTERPARTY_EMAIL, wallet: 'counterparty' },
]);

export interface CapTableRow {
  label: string;
  email: string;
  wallet: `0x${string}`;
  onChain: bigint;
  reported: bigint;
  cleared: boolean;
  reportedBy: string;
}

export interface CapTable {
  token: `0x${string}`;
  symbol: string;
  block: bigint;
  supply: bigint;
  rows: CapTableRow[];
  disagreements: string[];
}

export interface ChainReads {
  latestBlock: () => Promise<bigint>;
  balanceOf: (holder: `0x${string}`, atBlock: bigint) => Promise<bigint>;
  supply: (atBlock: bigint) => Promise<bigint>;
}

const onChainReads = (token: `0x${string}`): ChainReads => ({
  latestBlock: blockNumber,
  balanceOf: (holder, atBlock) => readTokenBalance(token, holder, atBlock),
  supply: (atBlock) => readTokenSupply(token, atBlock),
});

export interface CapTableSources {
  client?: Pick<BrickkenClient, 'getBalanceWhitelist'>;
  chain?: ChainReads;
}

const same = (one: string, other: string): boolean => one.toLowerCase() === other.toLowerCase();

/** Read one after another: their endpoints are never asked several things at once. */
export async function composeCapTable({
  client = createBrickkenClient(),
  chain,
}: CapTableSources = {}): Promise<CapTable> {
  const token = requireAddress('asset');
  const reads = chain ?? onChainReads(token);
  const block = await reads.latestBlock();
  const supply = await reads.supply(block);
  const rows: CapTableRow[] = [];
  const disagreements: string[] = [];

  for (const identity of IDENTITIES) {
    const told = await client.getBalanceWhitelist(SUNL_SYMBOL, identity.email);
    const wallet = requireAddress(identity.wallet);
    if (!same(told.walletAddress, wallet))
      disagreements.push(
        `Brickken hold ${told.walletAddress} for the ${identity.label}, and this project publishes ${wallet}`,
      );
    const onChain = await reads.balanceOf(wallet, block);
    if (told.balance !== onChain)
      disagreements.push(
        `Brickken report ${String(told.balance)} for the ${identity.label}, and the chain reads ${String(onChain)}`,
      );
    rows.push({
      label: identity.label,
      email: identity.email,
      wallet,
      onChain,
      reported: told.balance,
      cleared: told.isWhitelisted,
      reportedBy: told.balanceSource,
    });
  }

  const held = rows.reduce((total, row) => total + row.onChain, 0n);
  if (held !== supply)
    disagreements.push(
      `the rows account for ${String(held)} of the ${String(supply)} issued, so a holder is missing from this table`,
    );

  return { token, symbol: SUNL_SYMBOL, block, supply, rows, disagreements };
}

export interface CapTableRecord {
  at: string;
  token: string;
  symbol: string;
  block: string;
  supply: string;
  rows: Record<string, string | boolean>[];
  disagreements: string[];
}

const asRecord = (table: CapTable): CapTableRecord => ({
  at: new Date().toISOString(),
  token: table.token,
  symbol: table.symbol,
  block: String(table.block),
  supply: String(table.supply),
  rows: table.rows.map((row) => ({
    label: row.label,
    email: row.email,
    wallet: row.wallet,
    onChain: String(row.onChain),
    reported: String(row.reported),
    cleared: row.cleared,
    reportedBy: row.reportedBy,
  })),
  disagreements: table.disagreements,
});

export function recordCapTable(file: string, table: CapTable): CapTableRecord {
  const record = asRecord(table);
  appendRecord(file, record);
  return record;
}
