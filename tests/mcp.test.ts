import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestRecord } from '../src/brickken/log.js';
import { createMcpClient } from '../src/brickken/mcp.js';
import { readRecords } from '../src/shared/jsonl.js';
import { registerSecretsIn, scrub } from '../src/shared/secrets.js';
import { captureError } from './support/capture-error.js';

const FAKE_KEY = 'keeper-test-value-that-is-not-a-key-4471';
const URL_UNDER_TEST = 'https://mcp.example.invalid/mcp';

let directory: string;
let file: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-mcp-'));
  file = join(directory, 'brickken-requests.jsonl');
  vi.stubEnv('BRICKKEN_API_KEY', FAKE_KEY);
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', ...headers },
  });

const reply = (id: number, result: unknown) => ({ jsonrpc: '2.0', id, result });

const text = (value: string) => ({ content: [{ type: 'text', text: value }] });

interface Sent {
  id: number;
  method: string;
  params: Record<string, unknown>;
}

const transportOf = (answers: (sent: Sent) => Response) => {
  const bodies: string[] = [];
  const headers: Record<string, string>[] = [];
  const send = ((_url: string, init: RequestInit) => {
    const body = init.body as string;
    bodies.push(body);
    headers.push(init.headers as Record<string, string>);
    return Promise.resolve(answers(JSON.parse(body) as Sent));
  }) as unknown as typeof fetch;
  return { send, bodies, headers };
};

const handshake = (sent: Sent): Response | undefined => {
  if (sent.method === 'initialize') return json(reply(sent.id, { protocolVersion: '2025-06-18' }));
  if (sent.method === 'notifications/initialized') return new Response(null, { status: 202 });
  if (sent.params['name'] === 'configure') return json(reply(sent.id, text('configured')));
  return undefined;
};

const records = () => readRecords<RequestRecord>(file);

describe('an MCP call is evidence like any other call', () => {
  it('records the tool name as the method, against the MCP surface', async () => {
    const { send } = transportOf(
      (sent) => handshake(sent) ?? json(reply(sent.id, text('{"tokenSymbol":"SUNL"}'))),
    );

    const answer = await createMcpClient({ file, url: URL_UNDER_TEST, fetch: send }).call(
      'get_token_info',
      { tokenSymbol: 'SUNL' },
    );

    expect(answer).toBe('{"tokenSymbol":"SUNL"}');
    expect(records().map((record) => [record.surface, record.method])).toEqual([
      ['mcp', 'initialize'],
      ['mcp', 'notifications/initialized'],
      ['mcp', 'configure'],
      ['mcp', 'get_token_info'],
    ]);
  });

  it('reads an answer that arrives as an event stream rather than as JSON', async () => {
    const { send } = transportOf(
      (sent) =>
        handshake(sent) ??
        new Response(
          `event: message\ndata: ${JSON.stringify(reply(sent.id, text('streamed')))}\n\n`,
          {
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
    );

    const answer = await createMcpClient({ file, url: URL_UNDER_TEST, fetch: send }).call('x', {});

    expect(answer).toBe('streamed');
  });

  it('opens the session once, however many tools are called', async () => {
    const { send, bodies } = transportOf(
      (sent) => handshake(sent) ?? json(reply(sent.id, text('ok'))),
    );
    const client = createMcpClient({ file, url: URL_UNDER_TEST, fetch: send });

    await client.call('one', {});
    await client.call('two', {});

    expect(bodies.filter((body) => body.includes('"initialize"'))).toHaveLength(1);
  });

  it('echoes the session id the server issued on every later request', async () => {
    const { send, headers } = transportOf((sent) =>
      sent.method === 'initialize'
        ? json(reply(sent.id, {}), { 'mcp-session-id': 'session-99' })
        : (handshake(sent) ?? json(reply(sent.id, text('ok')))),
    );

    await createMcpClient({ file, url: URL_UNDER_TEST, fetch: send }).call('x', {});

    expect(headers[0]?.['mcp-session-id']).toBeUndefined();
    expect(headers.slice(1).every((sent) => sent['mcp-session-id'] === 'session-99')).toBe(true);
  });
});

describe('a refusal is never logged as a success', () => {
  it('treats a tool error carried inside a successful reply as a failure', async () => {
    const { send } = transportOf(
      (sent) =>
        handshake(sent) ??
        json(reply(sent.id, { ...text('tokenSymbol NOPE does not exist'), isError: true })),
    );

    const error = await captureError(() =>
      createMcpClient({ file, url: URL_UNDER_TEST, fetch: send }).call('get_token_info', {}),
    );

    expect(error.kind).toBe('brickkenRejected');
    expect(records().at(-1)).toMatchObject({ method: 'get_token_info', outcome: 'failure' });
  });

  it('raises and records a JSON-RPC error reply', async () => {
    const { send } = transportOf(
      (sent) =>
        handshake(sent) ??
        json({ jsonrpc: '2.0', id: sent.id, error: { code: -32602, message: 'bad params' } }),
    );

    const error = await captureError(() =>
      createMcpClient({ file, url: URL_UNDER_TEST, fetch: send }).call('x', {}),
    );

    expect(error.kind).toBe('brickkenRejected');
    expect(records().at(-1)).toMatchObject({ outcome: 'failure' });
  });

  it('records an unreachable server rather than losing the attempt', async () => {
    const send = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;

    const error = await captureError(() =>
      createMcpClient({ file, url: URL_UNDER_TEST, fetch: send }).call('x', {}),
    );

    expect(error.kind).toBe('brickkenUnreachable');
    expect(records()).toEqual([expect.objectContaining({ surface: 'mcp', outcome: 'failure' })]);
  });
});

describe('the credential travels in a body, so the log must never carry it', () => {
  it('keeps the API key out of the evidence file even though configure sends it', async () => {
    const { send, bodies } = transportOf(
      (sent) => handshake(sent) ?? json(reply(sent.id, text('ok'))),
    );

    await createMcpClient({ file, url: URL_UNDER_TEST, fetch: send }).call('get_token_info', {});

    expect(bodies.some((body) => body.includes(FAKE_KEY))).toBe(true);
    expect(readFileSync(file, 'utf8')).not.toContain(FAKE_KEY);
  });
});

describe('an answer we cannot read is a failure, never a quiet empty success', () => {
  it('refuses a reply carrying neither content nor structured content', async () => {
    const { send } = transportOf((sent) => handshake(sent) ?? json(reply(sent.id, {})));

    const error = await captureError(() =>
      createMcpClient({ file, url: URL_UNDER_TEST, fetch: send }).call('get_token_info', {}),
    );

    expect(error.kind).toBe('brickkenUnreadable');
    expect(records().at(-1)).toMatchObject({ method: 'get_token_info', outcome: 'failure' });
  });

  it('accepts structured content, which a server may send instead of text', async () => {
    const { send } = transportOf(
      (sent) => handshake(sent) ?? json(reply(sent.id, { structuredContent: { decimals: 18 } })),
    );

    const answer = await createMcpClient({ file, url: URL_UNDER_TEST, fetch: send }).call('t', {});

    expect(answer).toBe('{"decimals":18}');
  });

  it('refuses a tool list that is not a list, rather than reporting no tools', async () => {
    const { send } = transportOf((sent) => handshake(sent) ?? json(reply(sent.id, {})));

    const error = await captureError(() =>
      createMcpClient({ file, url: URL_UNDER_TEST, fetch: send }).listTools(),
    );

    expect(error.kind).toBe('brickkenUnreadable');
    expect(records().at(-1)).toMatchObject({ method: 'tools/list', outcome: 'failure' });
  });

  it('ignores a server request that happens to carry our own id', async () => {
    const { send } = transportOf(
      (sent) =>
        handshake(sent) ?? json({ jsonrpc: '2.0', id: sent.id, method: 'roots/list', params: {} }),
    );

    const error = await captureError(() =>
      createMcpClient({ file, url: URL_UNDER_TEST, fetch: send }).call('get_token_info', {}),
    );

    expect(error.kind).toBe('brickkenUnreadable');
    expect(records().at(-1)).toMatchObject({ outcome: 'failure' });
  });
});

describe('the credential is defended by the code, not by good luck', () => {
  it('scrubs the key out of an error even when the server echoes it back', async () => {
    const { send } = transportOf((sent) =>
      sent.method === 'initialize'
        ? json(reply(sent.id, {}))
        : json(
            reply(sent.id, { ...text(`rejected ${JSON.stringify(sent.params)}`), isError: true }),
          ),
    );

    const error = await captureError(() =>
      createMcpClient({ file, url: URL_UNDER_TEST, fetch: send }).call('x', {}),
    );

    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).toContain('[redacted]');
  });

  it('makes a private key redactable even when only the API key was read', () => {
    const envFile = join(directory, '.env');
    writeFileSync(envFile, `PRINCIPAL_PRIVATE_KEY=0x${'ab'.repeat(32)}\n`, 'utf8');

    registerSecretsIn(envFile);

    expect(scrub(`boom 0x${'ab'.repeat(32)}`)).toBe('boom [redacted]');
  });
});

describe('a credential body never follows a redirect to another host', () => {
  it('asks fetch to refuse redirects rather than resending the body elsewhere', async () => {
    const seen: RequestInit[] = [];
    const send = ((_url: string, init: RequestInit) => {
      seen.push(init);
      return Promise.resolve(json(reply(1, { protocolVersion: '2025-06-18' })));
    }) as unknown as typeof fetch;

    await captureError(() =>
      createMcpClient({ file, url: URL_UNDER_TEST, fetch: send }).call('x', {}),
    ).catch(() => undefined);

    expect(seen.every((init) => init.redirect === 'error')).toBe(true);
    expect(seen.every((init) => init.signal !== undefined)).toBe(true);
  });
});

describe('our own bad argument is our fault, not their outage', () => {
  it('does not report an unencodable argument as the API being unreachable', async () => {
    const { send } = transportOf((sent) => handshake(sent) ?? json(reply(sent.id, text('ok'))));

    const refused = createMcpClient({ file, url: URL_UNDER_TEST, fetch: send }).call('x', {
      amount: 1n,
    });

    await expect(refused).rejects.toThrow(/BigInt/);
    expect(records().at(-1)).toMatchObject({ outcome: 'failure' });
  });
});
