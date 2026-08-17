import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readSecretFile, writeSecret } from '../src/shared/secrets.js';

const FAKE_KEY = `0x${'b4'.repeat(32)}`;

const envFile = (body: string): string => {
  const file = join(mkdtempSync(join(tmpdir(), 'keeper-env-')), '.env');
  writeFileSync(file, body);
  return file;
};

const FILLED = ['# a comment', 'KEPT=already here', 'TARGET=', ''].join('\r\n');

describe('writing a value into the env file', () => {
  it('fills the named line and leaves every other line untouched', () => {
    const file = envFile(FILLED);

    writeSecret('TARGET', FAKE_KEY, file);

    expect(readSecretFile('TARGET', file)).toBe(FAKE_KEY);
    expect(readSecretFile('KEPT', file)).toBe('already here');
    expect(readFileSync(file, 'utf8')).toContain('# a comment');
  });

  it('refuses a variable that already holds a value, so a key can never be overwritten', () => {
    const file = envFile(FILLED);

    expect(() => {
      writeSecret('KEPT', FAKE_KEY, file);
    }).toThrow(/KEPT/);
    expect(readSecretFile('KEPT', file)).toBe('already here');
  });

  it('refuses a name the file does not carry rather than appending an unknown line', () => {
    const file = envFile(FILLED);

    expect(() => {
      writeSecret('STRANGER', FAKE_KEY, file);
    }).toThrow(/STRANGER/);
    expect(readFileSync(file, 'utf8')).not.toContain('STRANGER');
  });
});
