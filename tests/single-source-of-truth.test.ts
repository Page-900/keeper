import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
