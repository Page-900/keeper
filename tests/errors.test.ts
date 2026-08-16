import { afterEach, describe, expect, it, vi } from 'vitest';

import { ERROR_COPY, KeeperError, type ErrorKind } from '../src/shared/errors.js';
import { readSecret, scrubError } from '../src/shared/secrets.js';

const KINDS = Object.keys(ERROR_COPY) as ErrorKind[];
const FAKE_KEY = 'keeper-test-value-that-is-not-a-key-9713';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the error catalogue', () => {
  it('gives every kind a sentence a non-developer can read', () => {
    for (const kind of KINDS) {
      expect(ERROR_COPY[kind].length, `copy for ${kind}`).toBeGreaterThan(20);
    }
  });

  it('carries the kind, the shared copy, and the specific detail on one error', () => {
    const error = new KeeperError('secretMissing', 'BRICKKEN_API_KEY');

    expect(error.kind).toBe('secretMissing');
    expect(error.message).toContain(ERROR_COPY.secretMissing);
    expect(error.message).toContain('BRICKKEN_API_KEY');
    expect(error).toBeInstanceOf(Error);
  });

  it('claims no on-chain enforcement, because no revert has been observed to attribute', () => {
    const claims = KINDS.filter((kind) =>
      /revert|mandate|cap |blocked|refused by the chain/i.test(`${kind} ${ERROR_COPY[kind]}`),
    );

    expect(claims).toEqual([]);
  });
});

describe('scrubbing must not cost the classification', () => {
  it('keeps the kind when a KeeperError is scrubbed', () => {
    const scrubbed = scrubError(new KeeperError('brickkenRejected', 'GET /get-token-info'));

    expect(scrubbed).toBeInstanceOf(KeeperError);
    expect((scrubbed as KeeperError).kind).toBe('brickkenRejected');
  });

  it('removes a secret from the detail it was rebuilt from', () => {
    vi.stubEnv('KEEPER_TEST_SECRET', FAKE_KEY);
    readSecret('KEEPER_TEST_SECRET');

    const scrubbed = scrubError(new KeeperError('brickkenUnreachable', `sent ${FAKE_KEY}`));

    expect(scrubbed.message).not.toContain(FAKE_KEY);
    expect((scrubbed as KeeperError).kind).toBe('brickkenUnreachable');
  });
});
