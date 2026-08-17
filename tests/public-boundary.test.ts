import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Holds the patterns as literals, so it is the one file that cannot scan itself. */
const THIS_FILE = 'tests/public-boundary.test.ts';
const GENERATED = ['package-lock.json', 'LICENSE'];

const PUBLIC_PREFIX = 'ERC|EIP|RFC|BIP|UTF|SHA|AES|BIP39';

const PRIVATE_REFERENCE: RegExp[] = [
  new RegExp(String.raw`\b(?!(?:${PUBLIC_PREFIX})-)[A-Z][A-Z0-9]{2,}-\d+\b`),
  /\bAH-\d+\b/,
  /\b(CLAUDE|SECURITY_PROTOCOL|PHASE_LOG|ASSUMPTIONS|DEFERRED|MILESTONES|QUESTIONS)\b/,
  /\bworkflow\.md\b/,
  /\b(Core Law|Law \d|rule \d+|criterion \d+|subgoal \d|Milestone \d)\b/i,
];

const trackedFiles = (): string[] =>
  execFileSync('git', ['ls-files'], { encoding: 'utf8', cwd: APP_ROOT })
    .split('\n')
    .filter((file) => file !== '' && file !== THIS_FILE && !GENERATED.includes(file));

const offendingLines = (file: string): string[] =>
  readFileSync(join(APP_ROOT, file), 'utf8')
    .split('\n')
    .flatMap((line, index) =>
      PRIVATE_REFERENCE.some((pattern) => pattern.test(line))
        ? [`${file}:${String(index + 1)}`]
        : [],
    );

describe('the repository explains itself to a stranger who holds only the repository', () => {
  it('points at no document that is not published with it', () => {
    const offenders = trackedFiles().flatMap(offendingLines);

    expect(offenders).toEqual([]);
  });
});

/** The evidence log is committed, so a captured response is published the moment it lands. */
const SECRET_SHAPE: RegExp[] = [
  /[A-Za-z0-9._%+-]+@(?!example\.(?:com|org)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /\b0x[0-9a-fA-F]{64}\b/,
];

const leakingLines = (file: string): string[] =>
  readFileSync(join(APP_ROOT, file), 'utf8')
    .split('\n')
    .flatMap((line, index) =>
      SECRET_SHAPE.some((pattern) => pattern.test(line)) ? [`${file}:${String(index + 1)}`] : [],
    );

describe('nothing we hold in confidence reaches git', () => {
  it('carries no real email address and no 32-byte hex secret in any tracked file', () => {
    const offenders = trackedFiles().flatMap(leakingLines);

    expect(offenders).toEqual([]);
  });
});
