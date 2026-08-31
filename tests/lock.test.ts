import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { releaseLock, takeLock } from '../src/shared/lock.js';

let directory: string;
let file: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'keeper-lock-'));
  file = join(directory, 'battery.lock');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('one lock across every driver, because they send from the same two wallets', () => {
  it('lets the first run take it', () => {
    expect(takeLock('cycle one', file).taken).toBe(true);
  });

  it('stops a second run and names the one already going', () => {
    takeLock('cycle one', file);

    expect(takeLock('cycle two', file)).toEqual({ taken: false, by: 'cycle one' });
  });

  it('lets the next run take it once the first has finished', () => {
    takeLock('cycle one', file);
    releaseLock(file);

    expect(takeLock('cycle two', file).taken).toBe(true);
  });

  it('is safe to release when it was never taken', () => {
    expect(() => {
      releaseLock(file);
    }).not.toThrow();
  });
});
