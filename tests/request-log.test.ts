import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { recorded, sdkWrite, type RequestRecord } from '../src/brickken/log.js';
import { readRecords } from '../src/shared/jsonl.js';

let directory: string;
let file: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-log-'));
  file = join(directory, 'brickken-requests.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const records = () => readRecords<RequestRecord>(file);

describe('the log names the surface a call actually went through', () => {
  it('records an SDK write as sdk, against the path the SDK itself reports', async () => {
    await sdkWrite(file, 'ramsGrantMandate', () => Promise.resolve('ok'));

    expect(records()).toEqual([
      expect.objectContaining({
        surface: 'sdk',
        method: 'ramsGrantMandate',
        path: '/x402/rams/grant-mandate',
        outcome: 'success',
      }),
    ]);
  });

  it('records an MCP call as mcp rather than inheriting the SDK default', async () => {
    await recorded(file, { surface: 'mcp', method: 'tools/list', path: '/mcp' }, () =>
      Promise.resolve('ok'),
    );

    expect(records()).toEqual([
      expect.objectContaining({ surface: 'mcp', method: 'tools/list', path: '/mcp' }),
    ]);
  });

  it('records a CLI invocation as cli, carrying the command that ran', async () => {
    await recorded(file, { surface: 'cli', method: 'rams', path: 'rams mandate' }, () =>
      Promise.resolve('ok'),
    );

    expect(records()).toEqual([
      expect.objectContaining({ surface: 'cli', method: 'rams', path: 'rams mandate' }),
    ]);
  });

  it('keeps each surface distinct when several are used against one log', async () => {
    await sdkWrite(file, 'whitelist', () => Promise.resolve('ok'));
    await recorded(file, { surface: 'mcp', method: 'tools/call', path: '/mcp' }, () =>
      Promise.resolve('ok'),
    );
    await recorded(file, { surface: 'cli', method: 'rams', path: 'rams status' }, () =>
      Promise.resolve('ok'),
    );

    expect(records().map((record) => record.surface)).toEqual(['sdk', 'mcp', 'cli']);
  });
});

describe('a refusal is recorded, or the log cannot answer what we sent them', () => {
  it('writes a failure record for any surface and still raises', async () => {
    const refused = recorded(file, { surface: 'mcp', method: 'tools/call', path: '/mcp' }, () =>
      Promise.reject(new Error('refused')),
    );

    await expect(refused).rejects.toThrow('refused');
    expect(records()).toEqual([expect.objectContaining({ surface: 'mcp', outcome: 'failure' })]);
  });
});

describe('the log records what happened, not what a caller would prefer', () => {
  it('refuses a caller-supplied timestamp and any field it did not ask for', async () => {
    const forged: RequestRecord = {
      at: 'FORGED',
      surface: 'mcp',
      method: 'tools/call',
      path: '/mcp',
      outcome: 'success',
      status: 999,
    };

    await recorded(file, forged, () => Promise.resolve('ok'));

    const written = records()[0];
    expect(written?.at).not.toBe('FORGED');
    expect(written).not.toHaveProperty('status');
  });
});

describe('the record shape is pinned, not merely contained', () => {
  it('writes exactly these keys in exactly this order, so old and new records read alike', async () => {
    await recorded(file, { surface: 'cli', method: 'rams', path: 'rams mandate' }, () =>
      Promise.resolve('ok'),
    );

    const [written] = readRecords<Record<string, unknown>>(file);
    expect(Object.keys(written ?? {})).toEqual(['at', 'surface', 'method', 'path', 'outcome']);
    expect(written?.['at']).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });
});
