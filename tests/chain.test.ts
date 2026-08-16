import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { signerAddress } from '../src/chain/client.js';

const captureError = (run: () => unknown): Error => {
  try {
    run();
  } catch (cause) {
    if (cause instanceof Error) return cause;
  }
  throw new Error('expected the call to throw an Error');
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the signer comes from .env and nowhere else', () => {
  it('derives the agent address from the agent key', () => {
    const key = generatePrivateKey();
    vi.stubEnv('AGENT_PRIVATE_KEY', key);

    expect(signerAddress('agent')).toBe(privateKeyToAccount(key).address);
  });

  it('keeps the principal on its own key, so one wallet cannot play both roles', () => {
    vi.stubEnv('AGENT_PRIVATE_KEY', generatePrivateKey());
    vi.stubEnv('PRINCIPAL_PRIVATE_KEY', generatePrivateKey());

    expect(signerAddress('principal')).not.toBe(signerAddress('agent'));
  });

  it('fails closed on a missing key instead of signing as an unnamed wallet', () => {
    vi.stubEnv('AGENT_PRIVATE_KEY', '');

    expect(() => signerAddress('agent')).toThrow(/AGENT_PRIVATE_KEY/);
  });

  it('refuses a key that is not 32 bytes of hex', () => {
    vi.stubEnv('AGENT_PRIVATE_KEY', '0xdeadbeef');

    expect(() => signerAddress('agent')).toThrow(/AGENT_PRIVATE_KEY/);
  });
});

describe('a forced failure carries no key material', () => {
  it('redacts an out-of-range key that viem prints back as a decimal integer', () => {
    const outOfRange = `0x${'f'.repeat(64)}`;
    vi.stubEnv('AGENT_PRIVATE_KEY', outOfRange);

    const error = captureError(() => signerAddress('agent'));

    expect(error.message).not.toContain(BigInt(outOfRange).toString(10));
    expect(error.message).not.toContain('ffffffff');
    expect(error.stack ?? '').not.toContain(BigInt(outOfRange).toString(10));
  });

  it('names the variable rather than quoting the value it rejected', () => {
    vi.stubEnv('AGENT_PRIVATE_KEY', '0xnotakey');

    expect(captureError(() => signerAddress('agent')).message).not.toContain('notakey');
  });
});
