import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { agentActionRefusal, firstAction, simulateAgentAction } from '../src/chain/action.js';
import { blockNumber, sendDirect, signerAddress } from '../src/chain/client.js';
import { CHAIN_ID, requireAddress } from '../src/shared/config.js';
import { KeeperError } from '../src/shared/errors.js';

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
  vi.unstubAllGlobals();
});

const asyncCaptureError = async (run: () => Promise<unknown>): Promise<KeeperError> => {
  try {
    await run();
  } catch (cause) {
    if (cause instanceof KeeperError) return cause;
  }
  throw new Error('expected the call to throw a KeeperError');
};

/** Each test uses its own endpoint, because a confirmed one is never asked twice. */
const endpointServing = (chainId: number, name: string): string[] => {
  const asked: string[] = [];
  vi.stubEnv('SEPOLIA_RPC_URL', `https://${name}.invalid/rpc`);
  vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
    const { id, method } = JSON.parse(init.body) as { id: number; method: string };
    asked.push(method);
    const result = method === 'eth_chainId' ? `0x${chainId.toString(16)}` : '0x1';
    const body = JSON.stringify({ jsonrpc: '2.0', id, result });
    return Promise.resolve(new Response(body, { headers: { 'content-type': 'application/json' } }));
  });
  return asked;
};

describe('the endpoint is asked which chain it serves', () => {
  it('refuses to read from an endpoint serving another chain', async () => {
    endpointServing(1, 'mainnet-by-mistake');

    expect((await asyncCaptureError(() => blockNumber())).kind).toBe('wrongChain');
  });

  it('names the chain the endpoint answered with, so the mistake is findable', async () => {
    endpointServing(137, 'another-network');

    expect((await asyncCaptureError(() => blockNumber())).message).toContain('137');
  });

  it('stops a transaction before it is signed and sent, not after', async () => {
    vi.stubEnv('AGENT_PRIVATE_KEY', generatePrivateKey());
    const asked = endpointServing(1, 'wrong-chain-for-a-send');

    const error = await asyncCaptureError(() => sendDirect('agent', `0x${'ab'.repeat(20)}`, 0n));

    expect(error.kind).toBe('wrongChain');
    expect(asked).toEqual(['eth_chainId']);
  });

  it('reads from an endpoint that serves the configured chain', async () => {
    endpointServing(CHAIN_ID, 'correct-chain');

    expect(await blockNumber()).toBe(1n);
  });

  it('asks a confirmed endpoint once, not once per call', async () => {
    const asked = endpointServing(CHAIN_ID, 'asked-once');

    await blockNumber();
    await blockNumber();

    expect(asked.filter((method) => method === 'eth_chainId')).toHaveLength(1);
  });
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

const EMPTY_RETURN = `0x${'00'.repeat(31)}20${'00'.repeat(32)}`;

const callServing = (result: string): Record<string, unknown>[] => {
  const asked: Record<string, unknown>[] = [];
  vi.stubEnv('SEPOLIA_RPC_URL', 'https://no-key-needed.invalid/rpc');
  vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
    const { id, method, params } = JSON.parse(init.body) as {
      id: number;
      method: string;
      params: unknown[];
    };
    asked.push({ method, params });
    const served = method === 'eth_chainId' ? `0x${CHAIN_ID.toString(16)}` : result;
    const body = JSON.stringify({ jsonrpc: '2.0', id, result: served });
    return Promise.resolve(new Response(body, { headers: { 'content-type': 'application/json' } }));
  });
  return asked;
};

const callerIn = (asked: Record<string, unknown>[]): string => {
  const call = asked.find((one) => one['method'] === 'eth_call');
  const params = (call?.['params'] ?? []) as { from?: string }[];
  return params[0]?.from ?? '';
};

describe('the dry run asks as the agent without holding the agent key', () => {
  it('answers with no private key in the environment at all', async () => {
    vi.stubEnv('AGENT_PRIVATE_KEY', '');
    const asked = callServing(EMPTY_RETURN);

    expect(await agentActionRefusal(firstAction())).toBeNull();
    expect(callerIn(asked).toLowerCase()).toBe(requireAddress('agent').toLowerCase());
  });

  it('carries the block it was asked at, so three layers answer about one instant', async () => {
    vi.stubEnv('AGENT_PRIVATE_KEY', '');
    const asked = callServing(EMPTY_RETURN);

    await agentActionRefusal(firstAction(), 11_612_601n);

    const call = asked.find((one) => one['method'] === 'eth_call');
    expect((call?.['params'] as unknown[])[1]).toBe(`0x${(11_612_601).toString(16)}`);
  });

  it('leaves the keyed path needing its key, which is what makes the new one worth having', async () => {
    vi.stubEnv('AGENT_PRIVATE_KEY', '');
    callServing(EMPTY_RETURN);

    await expect(simulateAgentAction(firstAction())).rejects.toThrow(/AGENT_PRIVATE_KEY/);
  });
});
