import { afterEach, describe, expect, it, vi } from 'vitest';

import { readOptionalSecret, readSecret, scrub, scrubError } from '../src/shared/secrets.js';

const FAKE_KEY = `0x${'a3'.repeat(32)}`;
const FAKE_KEY_AS_DECIMAL = BigInt(FAKE_KEY).toString(10);
const FAKE_RPC_URL = 'https://sepolia.example.invalid/v2/not-a-real-project-id';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('reading a secret', () => {
  it('names the variable and never the value when it is missing', () => {
    vi.stubEnv('KEEPER_TEST_SECRET', '');

    expect(() => readSecret('KEEPER_TEST_SECRET')).toThrow(/KEEPER_TEST_SECRET/);
  });

  it('treats an empty variable as missing rather than as a valid empty key', () => {
    vi.stubEnv('KEEPER_TEST_SECRET', '');

    expect(readOptionalSecret('KEEPER_TEST_SECRET')).toBeUndefined();
  });

  it('returns the value when it is set', () => {
    vi.stubEnv('KEEPER_TEST_SECRET', FAKE_RPC_URL);

    expect(readSecret('KEEPER_TEST_SECRET')).toBe(FAKE_RPC_URL);
  });
});

describe('a secret never reaches a log or an error', () => {
  it('scrubs a value the moment it has been read', () => {
    vi.stubEnv('KEEPER_TEST_SECRET', FAKE_RPC_URL);
    readSecret('KEEPER_TEST_SECRET');

    expect(scrub(`request to ${FAKE_RPC_URL} failed`)).not.toContain('not-a-real-project-id');
  });

  it('scrubs the decimal form of a hex secret, not only the hex', () => {
    vi.stubEnv('KEEPER_TEST_SECRET', FAKE_KEY);
    readSecret('KEEPER_TEST_SECRET');

    expect(scrub(`got ${FAKE_KEY_AS_DECIMAL}`)).not.toContain(FAKE_KEY_AS_DECIMAL);
  });

  it('scrubs the body of a hex secret quoted without its 0x prefix', () => {
    vi.stubEnv('KEEPER_TEST_SECRET', FAKE_KEY);
    readSecret('KEEPER_TEST_SECRET');

    expect(scrub(`key ${FAKE_KEY.slice(2).toUpperCase()}`)).not.toContain('A3A3');
  });

  it('cleans the message and the stack of a thrown error', () => {
    vi.stubEnv('KEEPER_TEST_SECRET', FAKE_KEY);
    readSecret('KEEPER_TEST_SECRET');

    const scrubbed = scrubError(new Error(`signing failed with ${FAKE_KEY}`));

    expect(scrubbed.message).not.toContain('a3a3');
    expect(scrubbed.stack ?? '').not.toContain('a3a3');
  });

  it('returns a plain Error rather than the object that carried the secret', () => {
    vi.stubEnv('KEEPER_TEST_SECRET', FAKE_KEY);
    readSecret('KEEPER_TEST_SECRET');

    const original = Object.assign(new Error(`failed with ${FAKE_KEY}`), { details: FAKE_KEY });
    const scrubbed: object = scrubError(original);

    expect(scrubbed).not.toBe(original);
    expect('details' in scrubbed).toBe(false);
  });

  it('reports a thrown non-Error without leaking what it carried', () => {
    vi.stubEnv('KEEPER_TEST_SECRET', FAKE_KEY);
    readSecret('KEEPER_TEST_SECRET');

    expect(scrubError(FAKE_KEY).message).not.toContain('a3a3');
  });
});
