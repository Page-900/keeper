import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrickkenClient } from '../src/brickken/client.js';
import type { RequestRecord } from '../src/brickken/log.js';
import { readRecords } from '../src/shared/jsonl.js';
import { captureError } from './support/capture-error.js';

const FAKE_KEY = 'keeper-test-value-that-is-not-a-key-4471';
const OPERATOR_EMAIL = 'keeper-test-tokenizer-8823@example.com';
const TOKEN_INFO = {
  uuid: 'e2f0d0f7-0000-4000-8000-000000000000',
  tokenSymbol: 'SUNL',
  tokenName: 'Sunrise Lodge',
  tokenizerEmail: 'tokenizer@example.com',
  allowedTokenDecimals: 18,
  initialTokenSupply: 0,
  maxTokenSupply: 10000,
  companyWalletAddress: `0x${'ab'.repeat(20)}`,
};

const READ_BACK = {
  tokenSymbol: 'SUNL',
  tokenName: 'Sunrise Lodge',
  decimals: 18,
  maxSupply: 10000,
  companyWallet: `0x${'ab'.repeat(20)}`,
};

const HOLDER = `0x${'cd'.repeat(20)}`;

let logDirectory: string;
let logFile: string;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fresh Response per call, because a body can only be read once, exactly as on the wire. */
const respondWith = (respond: () => Response): ReturnType<typeof vi.fn> => {
  const transport = vi.fn(() => Promise.resolve(respond()));
  vi.stubGlobal('fetch', transport);
  return transport;
};

beforeEach(() => {
  logDirectory = mkdtempSync(join(tmpdir(), 'keeper-evidence-'));
  logFile = join(logDirectory, 'requests.jsonl');
  vi.stubEnv('BRICKKEN_API_KEY', FAKE_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(logDirectory, { recursive: true, force: true });
});

describe('the Brickken wrapper', () => {
  it('sends the key as the x-api-key header the API documents', async () => {
    const transport = respondWith(() => jsonResponse(TOKEN_INFO));

    await createBrickkenClient(logFile).getTokenInfo('SUNL');

    const [url, init] = transport.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.sandbox.brickken.com/get-token-info?tokenSymbol=SUNL');
    expect(init.headers).toEqual({ 'x-api-key': FAKE_KEY });
  });

  it('reads the fields it needs and leaves the tokenizer email behind', async () => {
    respondWith(() => jsonResponse(TOKEN_INFO));

    expect(await createBrickkenClient(logFile).getTokenInfo('SUNL')).toEqual(READ_BACK);
  });

  it('refuses a body of the wrong shape rather than passing it on as usable state', async () => {
    respondWith(() => jsonResponse({ ...TOKEN_INFO, maxTokenSupply: '10000' }));

    const error = await captureError(() => createBrickkenClient(logFile).getTokenInfo('SUNL'));

    expect(error.kind).toBe('brickkenUnreadable');
  });

  it('fails closed on a missing API key without sending anything', async () => {
    const transport = respondWith(() => jsonResponse(TOKEN_INFO));
    vi.stubEnv('BRICKKEN_API_KEY', '');

    const error = await captureError(() => createBrickkenClient(logFile).getTokenInfo('SUNL'));

    expect(error.kind).toBe('secretMissing');
    expect(transport).not.toHaveBeenCalled();
    expect(readRecords<RequestRecord>(logFile)).toEqual([]);
  });
});

describe('what reached Brickken is provable from the log', () => {
  it('records every call with its surface, path, and status', async () => {
    respondWith(() => jsonResponse(TOKEN_INFO));
    const client = createBrickkenClient(logFile);

    await client.getTokenInfo('SUNL');
    await client.getTokenInfo('SUNL');

    expect(readRecords<RequestRecord>(logFile)).toEqual([
      expect.objectContaining({
        surface: 'rest',
        method: 'GET',
        path: '/get-token-info?tokenSymbol=SUNL',
        outcome: 'success',
        status: 200,
      }),
      expect.objectContaining({ outcome: 'success', status: 200 }),
    ]);
  });

  it('records a refused call too, or the log cannot answer what we sent them', async () => {
    respondWith(() => jsonResponse({ message: 'nope' }, 500));

    const error = await captureError(() => createBrickkenClient(logFile).getTokenInfo('SUNL'));

    expect(error.kind).toBe('brickkenRejected');
    expect(readRecords<RequestRecord>(logFile)).toEqual([
      expect.objectContaining({ outcome: 'failure', status: 500 }),
    ]);
  });

  it('carries the reason the API gave, so a refusal is not a round trip to guess at', async () => {
    respondWith(() => jsonResponse({ message: 'tokenSymbol SUNL does not exist' }, 400));

    const error = await captureError(() => createBrickkenClient(logFile).getTokenInfo('SUNL'));

    expect(error.message).toContain('does not exist');
  });

  it('records a call the network never completed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('connect ECONNREFUSED'))),
    );

    const error = await captureError(() => createBrickkenClient(logFile).getTokenInfo('SUNL'));

    expect(error.kind).toBe('brickkenUnreachable');
    expect(readRecords<RequestRecord>(logFile)).toEqual([
      expect.objectContaining({ outcome: 'failure' }),
    ]);
  });

  it('redacts the tokenizer email when the API echoes it back in a refusal', async () => {
    vi.stubEnv('TOKENIZER_EMAIL', OPERATOR_EMAIL);
    respondWith(() => jsonResponse({ message: `no company for ${OPERATOR_EMAIL}` }, 400));

    const error = await captureError(() => createBrickkenClient(logFile).getTokenInfo('SUNL'));

    expect(error.message).not.toContain(OPERATOR_EMAIL);
    expect(error.message).toContain('[redacted]');
  });

  it('writes no API key into the evidence file', async () => {
    respondWith(() => jsonResponse(TOKEN_INFO));

    await createBrickkenClient(logFile).getTokenInfo('SUNL');

    expect(JSON.stringify(readRecords<RequestRecord>(logFile))).not.toContain(FAKE_KEY);
  });
});

describe('a rate limit is reported, never retried', () => {
  it('stops on 429 instead of trying again', async () => {
    const transport = respondWith(
      () => new Response('', { status: 429, headers: { 'retry-after': '60' } }),
    );

    const error = await captureError(() => createBrickkenClient(logFile).getTokenInfo('SUNL'));

    expect(error.kind).toBe('brickkenRateLimited');
    expect(error.message).toContain('60');
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe('the whitelist answer is read as an answer, never as a truthy body', () => {
  it('reports the clearance and where Brickken read it from', async () => {
    respondWith(() =>
      jsonResponse({ isWhitelisted: true, source: 'blockchain', tokenSymbol: 'SUNL' }),
    );

    const status = await createBrickkenClient(logFile).getWhitelistStatus('SUNL', HOLDER);

    expect(status).toEqual({ isWhitelisted: true, source: 'blockchain' });
  });

  it('refuses a body that answers with anything but a yes or a no', async () => {
    respondWith(() => jsonResponse({ isWhitelisted: 'true' }));

    const error = await captureError(() =>
      createBrickkenClient(logFile).getWhitelistStatus('SUNL', HOLDER),
    );

    expect(error.kind).toBe('brickkenUnreadable');
  });

  it('carries a refusal through rather than reading it as not whitelisted', async () => {
    respondWith(() => jsonResponse({ message: 'nope' }, 404));

    const error = await captureError(() =>
      createBrickkenClient(logFile).getWhitelistStatus('SUNL', HOLDER),
    );

    expect(error.kind).toBe('brickkenRejected');
  });
});
