import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  CHAIN_ID,
  MANDATE_WINDOW_SECONDS,
  MAX_CUMULATIVE_VALUE,
  MAX_TRANSACTION_VALUE,
  PERMITTED_ACTION,
  PRINCIPAL_HOLDING,
  requireAddress,
} from '../src/shared/config.js';
import { ANCHOR_FILE, type Anchor } from '../src/chain/anchors.js';
import { readRecords } from '../src/shared/jsonl.js';
import * as publicApi from '../src/index.js';

const SRC = new URL('../src/', import.meta.url);
const CONFIG = 'shared/config.ts';
const CHAIN_CLIENT = 'chain/client.ts';
const BRICKKEN_CLIENT = 'brickken/client.ts';

const read = (file: string): string => readFileSync(new URL(file, SRC), 'utf8');

const sourceFiles = (dir = SRC, prefix = ''): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const child = new URL(entry, dir);
    if (statSync(child).isDirectory())
      return sourceFiles(new URL(`${entry}/`, dir), `${prefix}${entry}/`);
    return entry.endsWith('.ts') ? [`${prefix}${entry}`] : [];
  });

describe('deployed addresses and chain ids live in exactly one place', () => {
  it('hardcodes no address outside the config module', () => {
    const offenders = sourceFiles()
      .filter((file) => file !== CONFIG)
      .filter((file) => /0x[a-fA-F0-9]{40}/.test(read(file)));

    expect(offenders).toEqual([]);
  });

  it('hardcodes the chain id nowhere but the config module', () => {
    const offenders = sourceFiles()
      .filter((file) => file !== CONFIG)
      .filter((file) => /11155111/.test(read(file)));

    expect(offenders).toEqual([]);
  });

  it('names the Brickken API host nowhere but the config module', () => {
    const offenders = sourceFiles()
      .filter((file) => file !== CONFIG)
      .filter((file) => read(file).includes('brickken.com'));

    expect(offenders).toEqual([]);
  });
});

const CONTRACT_TESTS = new URL('../contracts/test/', import.meta.url);
const REHEARSAL = 'ForkRehearsal.t.sol';

const solidityConstant = (name: string, file = REHEARSAL): string => {
  const source = readFileSync(new URL(file, CONTRACT_TESTS), 'utf8');
  const found = new RegExp(`constant ${name} = ([^;]+);`).exec(source);
  expect(found, `${name} is not declared in ${file}`).not.toBeNull();
  return found?.[1] ?? '';
};

const baseUnits = (literal: string): bigint => {
  const [whole = '0', exponent = '0'] = literal.split('e');
  return BigInt(whole) * 10n ** BigInt(exponent);
};

describe('the rehearsal is measured against the numbers the agent will use', () => {
  it('grants the same caps, holding, window, and chain the config module declares', () => {
    expect(baseUnits(solidityConstant('PER_TRANSACTION_CAP'))).toBe(MAX_TRANSACTION_VALUE);
    expect(baseUnits(solidityConstant('CUMULATIVE_CAP'))).toBe(MAX_CUMULATIVE_VALUE);
    expect(baseUnits(solidityConstant('HOLDING'))).toBe(PRINCIPAL_HOLDING);
    expect(solidityConstant('WINDOW_SECONDS')).toBe(
      `${String(MANDATE_WINDOW_SECONDS / 86400)} days`,
    );
    expect(solidityConstant('SEPOLIA')).toBe(String(CHAIN_ID));
  });

  it('rehearses against the addresses the config module declares, never a stale copy', () => {
    expect(solidityConstant('REGISTRY')).toBe(requireAddress('agentMandate'));
    expect(solidityConstant('COMPLIANCE')).toBe(requireAddress('complianceProvider'));
  });

  it('reads the gated amount from the same argument every contract test does', () => {
    const index = String(PERMITTED_ACTION.amountIndex);

    expect(solidityConstant('AMOUNT_INDEX')).toBe(index);
    expect(solidityConstant('AMOUNT_INDEX', 'AgentExecutor.t.sol')).toBe(index);
  });
});

describe('an address this project deployed is the one the chain recorded', () => {
  it('points the executor slot at the contract the evidence log says was deployed', () => {
    const deployed = readRecords<Anchor>(ANCHOR_FILE).find(
      (anchor) => anchor.action === 'deploy-executor' && anchor.status === 'success',
    );

    expect(deployed?.contract?.toLowerCase()).toBe(requireAddress('executor').toLowerCase());
  });
});

describe('the public entry point is not a way to read secrets', () => {
  it('keeps the env readers off the barrel, so importing keeper grants no access to .env', () => {
    expect(Object.keys(publicApi)).not.toContain('readSecret');
    expect(Object.keys(publicApi)).not.toContain('readOptionalSecret');
  });
});

describe('external vendors are wrapped, never called by business logic', () => {
  it('imports viem only in the chain wrapper and the config module', () => {
    const offenders = sourceFiles()
      .filter((file) => file !== CONFIG && file !== CHAIN_CLIENT)
      .filter((file) => read(file).includes("from 'viem"));

    expect(offenders).toEqual([]);
  });

  it('builds each viem client in exactly one place, so no call site can skip the scrubber', () => {
    const source = read(CHAIN_CLIENT);

    expect(source.match(/createPublicClient\(/g)).toHaveLength(1);
    expect(source.match(/createWalletClient\(/g)).toHaveLength(1);
  });

  it('reaches the network only in the Brickken wrapper', () => {
    const offenders = sourceFiles()
      .filter((file) => file !== BRICKKEN_CLIENT)
      .filter((file) => /\bfetch\(/.test(read(file)));

    expect(offenders).toEqual([]);
  });
});

describe('every failure this project raises carries a kind a caller can switch on', () => {
  it('throws no bare Error from src, so no failure is classified by message text', () => {
    const offenders = sourceFiles().filter((file) => read(file).includes('throw new Error('));

    expect(offenders).toEqual([]);
  });
});
