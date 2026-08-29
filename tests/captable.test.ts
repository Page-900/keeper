import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { HolderRecord } from '../src/brickken/client.js';
import {
  composeCapTable,
  recordCapTable,
  type CapTableRecord,
  type ChainReads,
} from '../src/captable.js';
import { COUNTERPARTY_EMAIL, HOLDER_EMAIL, requireAddress } from '../src/shared/config.js';
import { readRecords } from '../src/shared/jsonl.js';

const INVESTOR = requireAddress('principal');
const COUNTERPARTY = requireAddress('counterparty');
const STRANGER = `0x${'ee'.repeat(20)}` as const;

const BLOCK = 11_584_000n;
const sunl = (whole: bigint): bigint => whole * 10n ** 18n;

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-captable-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const told = (wallet: string, balance: bigint, cleared = true): HolderRecord => ({
  walletAddress: wallet,
  balance,
  isWhitelisted: cleared,
  balanceSource: 'blockchain',
});

interface Answers {
  [email: string]: HolderRecord;
}

let inFlight = 0;
let mostAtOnce = 0;

const clientSaying = (answers: Answers) => ({
  getBalanceWhitelist: async (_symbol: string, email: string): Promise<HolderRecord> => {
    inFlight += 1;
    mostAtOnce = Math.max(mostAtOnce, inFlight);
    await Promise.resolve();
    inFlight -= 1;
    const found = answers[email];
    if (found === undefined) throw new Error(`no answer for ${email}`);
    return found;
  },
});

interface ChainState {
  balances: Record<string, bigint>;
  supply: bigint;
}

const chainWith = ({ balances, supply }: ChainState): ChainReads => ({
  latestBlock: () => Promise.resolve(BLOCK),
  balanceOf: (holder) => Promise.resolve(balances[holder.toLowerCase()] ?? 0n),
  supply: () => Promise.resolve(supply),
});

const AGREED = {
  client: clientSaying({
    [HOLDER_EMAIL]: told(INVESTOR, sunl(1_750n)),
    [COUNTERPARTY_EMAIL]: told(COUNTERPARTY, sunl(250n)),
  }),
  chain: chainWith({
    balances: { [INVESTOR.toLowerCase()]: sunl(1_750n), [COUNTERPARTY.toLowerCase()]: sunl(250n) },
    supply: sunl(2_000n),
  }),
};

const compose = (sources: Partial<typeof AGREED>) => composeCapTable({ ...AGREED, ...sources });

describe('the cap table is composed from both sides and reconciled', () => {
  it('names the identity, the wallet, the clearance and both balances', async () => {
    const table = await compose({});

    expect(table.disagreements).toEqual([]);
    expect(table.rows).toEqual([
      {
        label: 'investor',
        email: HOLDER_EMAIL,
        wallet: INVESTOR,
        onChain: sunl(1_750n),
        reported: sunl(1_750n),
        cleared: true,
        reportedBy: 'blockchain',
      },
      {
        label: 'counterparty',
        email: COUNTERPARTY_EMAIL,
        wallet: COUNTERPARTY,
        onChain: sunl(250n),
        reported: sunl(250n),
        cleared: true,
        reportedBy: 'blockchain',
      },
    ]);
  });

  it('pins every balance to one block, so the table is one moment and not several', async () => {
    const table = await compose({});

    expect(table.block).toBe(BLOCK);
  });

  it('asks their endpoint one identity at a time, never several at once', async () => {
    inFlight = 0;
    mostAtOnce = 0;

    await compose({});

    expect(mostAtOnce).toBe(1);
  });
});

describe('a disagreement is reported, never resolved in favour of either side', () => {
  it('reports a balance they report differently from the chain', async () => {
    const table = await compose({
      client: clientSaying({
        [HOLDER_EMAIL]: told(INVESTOR, sunl(2_000n)),
        [COUNTERPARTY_EMAIL]: told(COUNTERPARTY, sunl(250n)),
      }),
    });

    expect(table.disagreements).toEqual([expect.stringContaining('for the investor')]);
  });

  it('reports a wallet they hold for an identity that is not the published one', async () => {
    const table = await compose({
      client: clientSaying({
        [HOLDER_EMAIL]: told(STRANGER, sunl(1_750n)),
        [COUNTERPARTY_EMAIL]: told(COUNTERPARTY, sunl(250n)),
      }),
    });

    expect(table.disagreements[0]).toContain(STRANGER);
    expect(table.disagreements[0]).toContain('this project publishes');
  });

  it('reports a holder it does not name, by the amount that does not add up', async () => {
    const table = await compose({
      chain: chainWith({
        balances: {
          [INVESTOR.toLowerCase()]: sunl(1_750n),
          [COUNTERPARTY.toLowerCase()]: sunl(250n),
        },
        supply: sunl(2_500n),
      }),
    });

    expect(table.disagreements).toEqual([
      expect.stringContaining('so a holder is missing from this table'),
    ]);
  });
});

describe('what is written down keeps every amount exact', () => {
  it('records each amount as a string, because a JSON number is approximate', async () => {
    const file = join(directory, 'cap-table.jsonl');
    const table = await compose({});

    recordCapTable(file, table);

    const [written] = readRecords<CapTableRecord>(file);
    expect(written?.supply).toBe('2000000000000000000000');
    expect(written?.rows[0]).toMatchObject({
      wallet: INVESTOR,
      onChain: '1750000000000000000000',
      reported: '1750000000000000000000',
      cleared: true,
    });
    expect(written?.disagreements).toEqual([]);
  });
});
