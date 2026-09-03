import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
  /\bgoal-\d/i,
  /\b(Core Law|Law \d|rule \d+|criterion \d+|subgoal \d|Milestone \d)\b/i,
];

const trackedFiles = (): string[] =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
    cwd: APP_ROOT,
  })
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

const ANCHOR_LOG = 'evidence/chain-anchors.jsonl';
const REFUSAL_LOG = 'evidence/refusals.jsonl';
const REQUEST_LOG = 'evidence/brickken-requests.jsonl';
const OFFERING_LOG = 'evidence/offering-prepares.jsonl';
const CLOSE_LOG = 'evidence/offering-closes.jsonl';
const BATTERY_LOG = 'evidence/battery.jsonl';
const JAILBREAK_LOG = 'evidence/jailbreak.jsonl';
const SIGNATURE_LOG = 'evidence/signatures.jsonl';

const PREPARED_ID = /(?<="txId":")0x[0-9a-fA-F]{64}(?=")/g;

const PUBLISHED_HASH = /(?<="transactionHash":")0x[0-9a-fA-F]{64}(?=")/g;

/** A hash inside an explorer link is published by definition. A bare one is still a secret. */
const LINKED_HASH = /(?<=sepolia\.etherscan\.io\/tx\/)0x[0-9a-fA-F]{64}/g;

/** The signature it names is in the calldata of the published transaction beside it. */
const SIGNATURE_DIGEST = /(?<="signatureDigest":")0x[0-9a-fA-F]{64}(?=")/g;

const exact = (value: string): RegExp => new RegExp(value, 'g');

/** Every one of these is read from a public chain or a public transaction. */
const IDENTITY_REF = '0x59d0004b514dbb6948b1b54ba9dbf20767d8f9a87925cfd65ea3419ebca512e0';
const RECORDER_ROLE = '0xf996da754c790e95d5c7ca3330cfcad529487fe9d1d8edb7afc65076fdf9adb4';

/** A hash and a prepared id are shaped exactly like a key, and both exist to be published. */
const PUBLISHED: Record<string, RegExp[]> = {
  [ANCHOR_LOG]: [PUBLISHED_HASH],
  [REFUSAL_LOG]: [PUBLISHED_HASH],
  'README.md': [LINKED_HASH],
  'SURFACES.md': [LINKED_HASH],
  [REQUEST_LOG]: [
    PREPARED_ID,
    /(?<=[?&](?:hash|txId|identityRef|metadata|actions)=)0x[0-9a-fA-F]{64}/g,
  ],
  [OFFERING_LOG]: [PREPARED_ID],
  [CLOSE_LOG]: [PREPARED_ID, PUBLISHED_HASH],
  [BATTERY_LOG]: [PUBLISHED_HASH],
  [JAILBREAK_LOG]: [PUBLISHED_HASH],
  [SIGNATURE_LOG]: [PUBLISHED_HASH, SIGNATURE_DIGEST],
  'src/shared/config.ts': [exact(IDENTITY_REF)],
  'tests/registry.test.ts': [exact(RECORDER_ROLE)],
};

const scannable = (file: string): string => {
  const text = readFileSync(join(APP_ROOT, file), 'utf8');
  return (PUBLISHED[file] ?? []).reduce((clean, published) => clean.replace(published, ''), text);
};

const leakingLines = (file: string): string[] =>
  scannable(file)
    .split('\n')
    .flatMap((line, index) =>
      SECRET_SHAPE.some((pattern) => pattern.test(line)) ? [`${file}:${String(index + 1)}`] : [],
    );

const ENV_FILE = join(APP_ROOT, '.env');

/** Shape rules guess. This compares against the real values, on the machine that holds them. */
const envValues = (): string[] =>
  existsSync(ENV_FILE)
    ? readFileSync(ENV_FILE, 'utf8')
        .split(/\r?\n/)
        .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
        .map((line) => line.slice(line.indexOf('=') + 1).trim())
        .filter((value) => value.length >= 16)
    : [];

describe('nothing we hold in confidence reaches git', () => {
  it('carries no real email address and no 32-byte hex secret in any tracked file', () => {
    const offenders = trackedFiles().flatMap(leakingLines);

    expect(offenders).toEqual([]);
  });

  it('carries no value from the local env file, in any shape or field', () => {
    const secrets = envValues();
    const offenders = trackedFiles().filter((file) => {
      const text = readFileSync(join(APP_ROOT, file), 'utf8');
      return secrets.some((secret) => text.includes(secret));
    });

    expect(offenders).toEqual([]);
  });
});
