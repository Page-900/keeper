import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ANCHOR_FILE, recordAnchor, type Anchor, type Claim } from '../src/chain/anchors.js';
import { BATTERY_FILE, type BatteryCase } from '../src/chain/battery.js';
import { LAB_SLOTS, addressSlots, requireAddress, type AddressName } from '../src/shared/config.js';
import { readRecords } from '../src/shared/jsonl.js';
import { checkVenue, venueOfAddress } from '../src/chain/venue.js';

const LAB_MANDATE = `0x${'1a'.repeat(20)}` as const;

const withLab = { ...addressSlots, labMandate: LAB_MANDATE };

const registryAddress = requireAddress('agentMandate');

describe('a venue is a property of the address slot, not of the prose around it', () => {
  it('calls every lab slot a lab and everything else the shared registry', () => {
    for (const name of LAB_SLOTS) expect(venueOfAddress(name)).toBe('lab');

    const shared = (Object.keys(addressSlots) as AddressName[]).filter(
      (name) => !LAB_SLOTS.includes(name),
    );
    for (const name of shared) expect(venueOfAddress(name)).toBe('registry');
  });

  it('names a lab slot for every contract the lab deploys', () => {
    expect([...LAB_SLOTS].sort()).toEqual([
      'labAsset',
      'labComplianceProvider',
      'labExecutor',
      'labMandate',
    ]);
  });
});

describe('a record that names one deployment cannot be filed under the other', () => {
  it('reads a record with no venue as the shared registry, so no history is rewritten', () => {
    expect(checkVenue({ contract: registryAddress })).toBe('registry');
  });

  it('refuses a lab record that names a shared registry address', () => {
    expect(() => checkVenue({ venue: 'lab', contract: registryAddress }, withLab)).toThrow(
      /registry/,
    );
  });

  it('refuses a shared registry record that names a lab address', () => {
    expect(() => checkVenue({ venue: 'registry', contract: LAB_MANDATE }, withLab)).toThrow(/lab/);
  });

  it('refuses an undeclared record that names a lab address, which is the silent case', () => {
    expect(() => checkVenue({ contract: LAB_MANDATE }, withLab)).toThrow(/lab/);
  });

  it('refuses one record that names both deployments at once', () => {
    const mixed = { venue: 'lab', contract: LAB_MANDATE, state: { mandateAsset: registryAddress } };

    expect(() => checkVenue(mixed, withLab)).toThrow(/both/);
  });

  it('finds an address nested inside a record, because the battery nests its chain state', () => {
    expect(() => checkVenue({ state: { mandateAsset: LAB_MANDATE } }, withLab)).toThrow(/lab/);
  });

  it('ignores an address no slot claims, so a counterparty never decides a venue', () => {
    expect(checkVenue({ venue: 'lab', to: `0x${'ee'.repeat(20)}` }, withLab)).toBe('lab');
  });
});

describe('the writer files the venue, so it is never left to whoever reads the file later', () => {
  const temporary = (): string => {
    const directory = mkdtempSync(join(tmpdir(), 'keeper-venue-'));
    return join(directory, 'records.jsonl');
  };

  const claim: Claim = {
    action: 'deploy-executor',
    transactionHash: `0x${'11'.repeat(32)}`,
    blockNumber: '1',
    status: 'success',
    contract: registryAddress,
    gasUsed: '1',
  };

  it('marks an anchor the shared registry unless it is told otherwise', () => {
    const file = temporary();

    expect(recordAnchor(file, claim).venue).toBe('registry');
    expect(readRecords<Anchor>(file)[0]?.venue).toBe('registry');
  });

  it('refuses to write an anchor filed against a deployment it does not name', () => {
    const file = temporary();

    expect(() => recordAnchor(file, { ...claim, venue: 'lab' })).toThrow(/registry/);
    expect(readRecords<Anchor>(file)).toHaveLength(0);
  });
});

describe('the evidence already recorded passes the gate it was written before', () => {
  const anchors = readRecords<Anchor>(ANCHOR_FILE);
  const battery = readRecords<BatteryCase>(BATTERY_FILE);

  it('has something to check, so a deleted evidence file cannot pass as a clean run', () => {
    expect(anchors.length).toBeGreaterThan(0);
    expect(battery.length).toBeGreaterThan(0);
  });

  it('files every anchor against the deployment it actually names', () => {
    for (const anchor of anchors) expect(checkVenue(anchor)).toBe('registry');
  });

  it('files every battery case against the deployment it actually names', () => {
    for (const record of battery) expect(checkVenue(record)).toBe('registry');
  });
});
