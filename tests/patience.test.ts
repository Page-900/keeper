import { describe, expect, it } from 'vitest';

import { KeeperError } from '../src/shared/errors.js';
import { whenNotBusy } from '../src/shared/patience.js';
import { captureError } from './support/capture-error.js';

const QUICK = { seconds: 0.01 };

const failing = (times: number, cause: Error): (() => Promise<string>) => {
  let left = times;
  return () => {
    if (left === 0) return Promise.resolve('answered');
    left -= 1;
    return Promise.reject(cause);
  };
};

const BUSY = new KeeperError('modelBusy', 'try again in 18 seconds');

describe('a batch run waits out the vendor rather than losing the run', () => {
  it('waits for a busy vendor and takes the answer that follows', async () => {
    const waited: number[] = [];

    const said = await whenNotBusy(failing(2, BUSY), {
      ...QUICK,
      onWait: (seconds) => waited.push(seconds),
    });

    expect(said).toBe('answered');
    expect(waited).toEqual([0.01, 0.01]);
  });

  it('gives up after the waits it is allowed, and the vendor error is what surfaces', async () => {
    const error = await captureError(() => whenNotBusy(failing(9, BUSY), { ...QUICK, waits: 2 }));

    expect(error.kind).toBe('modelBusy');
  });

  it('never waits on any other failure, because only a wait is a wait', async () => {
    const unreachable = new KeeperError('modelUnreachable', 'socket hang up');
    let waits = 0;

    const error = await captureError(() =>
      whenNotBusy(failing(1, unreachable), { ...QUICK, onWait: () => (waits += 1) }),
    );

    expect(error.kind).toBe('modelUnreachable');
    expect(waits).toBe(0);
  });
});
