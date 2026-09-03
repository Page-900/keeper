import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CapTable } from '../src/captable.js';
import { ANCHOR_FILE, type Anchor, type AnchorAction } from '../src/chain/anchors.js';
import { BATTERY_FILE, type BatteryCase } from '../src/chain/battery.js';
import { REFUSAL_FILE, type Refusal } from '../src/chain/refusal.js';
import { SIGNATURE_FILE, type SignatureRecord } from '../src/chain/signatures.js';
import { authorityTable, demoView, evidenceTable, type EvidenceFiles } from '../src/demo/view.js';
import { mandateInPlainWords } from '../src/keeper/decide.js';
import type { IssuerRecord } from '../src/keeper/material.js';
import { POLICY, policyInPlainWords } from '../src/keeper/policy.js';
import {
  CHAIN_ID,
  HOLDER_EMAIL,
  SUNL_NAME,
  SUNL_SYMBOL,
  requireAddress,
} from '../src/shared/config.js';
import { appendRecord } from '../src/shared/jsonl.js';
import { registryState } from './support/registry-state.js';

const VIEW_SOURCE = fileURLToPath(new URL('../src/demo/view.ts', import.meta.url));

const ISSUER: IssuerRecord = {
  symbol: SUNL_SYMBOL,
  name: SUNL_NAME,
  tokenPrice: '50',
  acceptedCoin: 'BKN',
  startDate: '2026-08-29T07:50:00.000Z',
  endDate: '2026-09-05T07:50:00.000Z',
};

const sunl = (whole: bigint): bigint => whole * 10n ** 18n;

const capTable = (): CapTable => ({
  token: requireAddress('asset'),
  symbol: SUNL_SYMBOL,
  block: 11_607_087n,
  supply: sunl(10_000n),
  rows: [
    {
      label: 'investor',
      email: HOLDER_EMAIL,
      wallet: requireAddress('principal'),
      onChain: sunl(2_000n),
      reported: sunl(2_000n),
      cleared: true,
      reportedBy: 'blockchain',
    },
  ],
  disagreements: [],
});

const hashOf = (byte: string): `0x${string}` => `0x${byte.repeat(32)}`;

const anchor = (action: AnchorAction, over: Partial<Anchor> = {}): Anchor => ({
  at: '2026-08-25T00:00:00.000Z',
  action,
  chainId: CHAIN_ID,
  transactionHash: hashOf('11'),
  blockNumber: '11558501',
  status: 'success',
  contract: null,
  gasUsed: '21000',
  ...over,
});

const batteryCase = (over: Partial<BatteryCase> = {}): BatteryCase => ({
  at: '2026-08-29T00:00:00.000Z',
  chainId: CHAIN_ID,
  case: 'C1',
  layer: 'mandate',
  blockNumber: '11593789',
  transactionHash: hashOf('22'),
  revert: { error: 'CannotExecute', args: [] },
  firstFalse: 'per transaction cap',
  clauses: [],
  agreedWithChain: true,
  state: registryState(),
  ...over,
});

const refusal = (over: Partial<Refusal> = {}): Refusal => ({
  at: '2026-08-27T00:00:00.000Z',
  chainId: CHAIN_ID,
  blockNumber: '11566500',
  rule: 'maxTransactionValue',
  decidedBy: 'mandate',
  reportedBy: 'executor',
  allowedAmount: String(sunl(250n)),
  refusedAmount: String(sunl(250n) + 1n),
  allowedAnswer: true,
  refusedAnswer: false,
  revert: { error: 'CannotExecute', args: [] },
  state: registryState(),
  transactionHash: hashOf('33'),
  ...over,
});

const refusalAnchor = anchor('agent-refusal', {
  blockNumber: '11566500',
  status: 'reverted',
  transactionHash: hashOf('33'),
});

const signature = (over: Partial<SignatureRecord> = {}): SignatureRecord => ({
  at: '2026-08-30T12:18:15.704Z',
  chainId: CHAIN_ID,
  case: 'D1',
  refused: true,
  expect: 'SignatureExpired',
  revert: { error: 'SignatureExpired', args: [] },
  agent: requireAddress('probe'),
  nonceSigned: '3',
  nonceBefore: '3',
  deadline: '1788091968',
  clockBefore: '1788092268',
  blockNumber: '11598768',
  transactionHash: hashOf('44'),
  signatureDigest: hashOf('55'),
  ...over,
});

let directory = '';
let files: Required<EvidenceFiles>;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-view-'));
  files = {
    battery: join(directory, 'battery.jsonl'),
    anchors: join(directory, 'chain-anchors.jsonl'),
    refusals: join(directory, 'refusals.jsonl'),
    signatures: join(directory, 'signatures.jsonl'),
  };
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('the evidence table serves what the chain ran and nothing else', () => {
  it('serves no hash that no evidence file recorded', () => {
    const recorded = [BATTERY_FILE, ANCHOR_FILE, REFUSAL_FILE]
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    const invented = evidenceTable().filter((row) => !recorded.includes(row.transactionHash));

    expect(invented).toEqual([]);
  });

  it('links every row to the transaction it is a claim about', () => {
    const unlinked = evidenceTable().filter((row) => !row.explorer.includes(row.transactionHash));

    expect(unlinked).toEqual([]);
  });

  it('leaves out a refusal that was only simulated, because no transaction proves it', () => {
    appendRecord(files.refusals, { ...refusal(), transactionHash: null });

    expect(evidenceTable(files)).toEqual([]);
  });

  it('leaves out a refusal recorded before the shape carried a hash at all', () => {
    const beforeTheShapeChanged: Record<string, unknown> = { ...refusal() };
    delete beforeTheShapeChanged['transactionHash'];
    appendRecord(files.refusals, beforeTheShapeChanged);

    expect(evidenceTable(files)).toEqual([]);
  });

  it('names the clause the mandate refused on and the reason the chain gave', () => {
    appendRecord(files.battery, batteryCase());

    expect(evidenceTable(files)).toEqual([
      expect.objectContaining({
        claim: expect.stringContaining('per transaction cap') as string,
        layer: 'mandate',
        outcome: 'refused',
        reason: 'CannotExecute',
      }),
    ]);
  });

  it('serves an allowed action only from an anchor that succeeded', () => {
    appendRecord(files.anchors, anchor('keeper-action', { status: 'reverted' }));
    appendRecord(files.anchors, anchor('agent-action'));

    expect(evidenceTable(files).map((row) => row.outcome)).toEqual(['allowed']);
  });

  it('serves nothing from the anchors that provisioned the deployment', () => {
    appendRecord(files.anchors, anchor('grant-mandate'));
    appendRecord(files.anchors, anchor('mint-holding'));

    expect(evidenceTable(files)).toEqual([]);
  });

  it('leaves out a refusal whose transaction no anchor confirms', () => {
    appendRecord(files.refusals, refusal());

    expect(evidenceTable(files)).toEqual([]);
  });

  it('dates a refusal by the block it ran in and not the block it was read at', () => {
    appendRecord(files.refusals, refusal({ blockNumber: '11566499' }));
    appendRecord(files.anchors, refusalAnchor);

    expect(evidenceTable(files).map((row) => row.blockNumber)).toEqual(['11566500']);
  });

  it('reads in block order, so the table tells the story in the order it happened', () => {
    appendRecord(files.refusals, refusal({ blockNumber: '11566499' }));
    appendRecord(files.anchors, refusalAnchor);
    appendRecord(files.battery, batteryCase({ blockNumber: '11593789' }));
    appendRecord(files.anchors, anchor('agent-action', { blockNumber: '11558501' }));

    expect(evidenceTable(files).map((row) => row.blockNumber)).toEqual([
      '11558501',
      '11566500',
      '11593789',
    ]);
  });
});

describe('changing the authority is its own claim and its own table', () => {
  it('serves no hash that no evidence file recorded', () => {
    const recorded = readFileSync(SIGNATURE_FILE, 'utf8');

    const invented = authorityTable().filter((row) => !recorded.includes(row.transactionHash));

    expect(invented).toEqual([]);
  });

  it('says what was tried, in plain words, and what the registry answered', () => {
    appendRecord(files.signatures, signature());

    expect(authorityTable(files.signatures)).toEqual([
      expect.objectContaining({
        claim: 'a signed instruction submitted after its deadline had passed',
        outcome: 'refused',
        reason: 'SignatureExpired',
        blockNumber: '11598768',
      }),
    ]);
  });

  it('serves nothing from a record that refused nothing, whatever it is named', () => {
    appendRecord(files.signatures, signature({ refused: false, revert: null }));
    appendRecord(files.signatures, signature({ case: 'revoke', refused: false, revert: null }));

    expect(authorityTable(files.signatures)).toEqual([]);
  });

  it('keeps these rows out of the table about moving money', () => {
    appendRecord(files.signatures, signature());
    appendRecord(files.battery, batteryCase());

    expect(evidenceTable(files).map((row) => row.claim)).toEqual([
      expect.stringContaining('outside the mandate') as string,
    ]);
  });
});

describe('the page is told what the mandate and the policy say, in their own words', () => {
  it('reads the mandate through the same words the agent is given', () => {
    const state = registryState();

    expect(demoView({ state, capTable: capTable(), issuer: ISSUER, files }).mandate).toEqual(
      mandateInPlainWords(state),
    );
  });

  it('reads the policy through the same words the agent is given', () => {
    const view = demoView({ state: registryState(), capTable: capTable(), issuer: ISSUER, files });

    expect(view.policy).toEqual(policyInPlainWords(POLICY));
  });

  it('says the hotel is invented and takes the offering terms from the issuer record', () => {
    const view = demoView({ state: registryState(), capTable: capTable(), issuer: ISSUER, files });

    expect(view.scenario.join(' ')).toContain('invented');
    expect(view.scenario.join(' ')).toContain(`${ISSUER.tokenPrice} ${ISSUER.acceptedCoin}`);
    expect(view.scenario.join(' ')).toContain(ISSUER.endDate);
  });

  it('reports the block each half was read at, because they are two different reads', () => {
    const table = capTable();
    const state = registryState();

    const view = demoView({ state, capTable: table, issuer: ISSUER, files });

    expect(view.blockNumber).toBe(state.blockNumber);
    expect(view.holdersAtBlock).toBe(String(table.block));
  });

  it('holds each wallet in whole tokens beside what Brickken report for it', () => {
    const view = demoView({ state: registryState(), capTable: capTable(), issuer: ISSUER, files });

    expect(view.holders).toEqual([
      expect.objectContaining({
        label: 'investor',
        onChain: `2000 ${SUNL_SYMBOL}`,
        reported: `2000 ${SUNL_SYMBOL}`,
        cleared: true,
      }),
    ]);
  });

  it('passes on a disagreement between the chain and what Brickken report', () => {
    const table = { ...capTable(), disagreements: ['the chain and the report differ'] };

    expect(demoView({ state: registryState(), capTable: table, issuer: ISSUER, files })).toEqual(
      expect.objectContaining({ disagreements: table.disagreements }),
    );
  });
});

describe('the read model holds no value of its own', () => {
  it('hardcodes no address and no hash, so every one it serves came from a record', () => {
    const source = readFileSync(VIEW_SOURCE, 'utf8');

    expect(source).not.toMatch(/0x[a-fA-F0-9]{40}/);
    expect(source).not.toMatch(/0x[a-fA-F0-9]{64}/);
  });
});

describe('the situation takes the holding from the chain, never from a constant', () => {
  const spent = (): CapTable => {
    const table = capTable();
    const [investor] = table.rows;
    if (investor === undefined) throw new Error('the fixture lost its investor row');
    return { ...table, rows: [{ ...investor, onChain: sunl(1_750n), reported: sunl(1_750n) }] };
  };

  it('names what the investor holds now, not what they started with', () => {
    const view = demoView({ state: registryState(), capTable: spent(), issuer: ISSUER, files });

    expect(view.scenario.join(' ')).toContain('1750 SUNL of it');
    expect(view.scenario.join(' ')).not.toContain('2000 SUNL of it');
  });

  it('names the block the holding was read at, so it is dated like every other read', () => {
    const view = demoView({ state: registryState(), capTable: spent(), issuer: ISSUER, files });

    expect(view.scenario.join(' ')).toContain(String(capTable().block));
  });

  it('claims no holding at all when the read did not answer', () => {
    const view = demoView({ state: registryState(), capTable: null, issuer: ISSUER, files });

    expect(view.scenario.join(' ')).toContain('did not answer');
    expect(view.scenario.join(' ')).not.toMatch(/\d+ SUNL of it/);
  });

  it('claims no holding when the table came back without the investor in it', () => {
    const table = { ...capTable(), rows: [] };

    const view = demoView({ state: registryState(), capTable: table, issuer: ISSUER, files });

    expect(view.scenario.join(' ')).toContain('did not answer');
  });
});
