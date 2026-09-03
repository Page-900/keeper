import { setTimeout as after } from 'node:timers/promises';

import { KeeperError } from './errors.js';

export const BUSY_WAIT_SECONDS = 25;

export const BUSY_WAITS = 4;

const busy = (cause: unknown): boolean =>
  cause instanceof KeeperError && cause.kind === 'modelBusy';

export interface Patience {
  waits?: number;
  seconds?: number;
  onWait?: (seconds: number) => void;
}

/** The vendor allows a fixed number of tokens a minute, so a batch waits and says it waited. */
export async function whenNotBusy<T>(
  work: () => Promise<T>,
  { waits = BUSY_WAITS, seconds = BUSY_WAIT_SECONDS, onWait }: Patience = {},
): Promise<T> {
  for (let left = waits; ; left -= 1) {
    try {
      return await work();
    } catch (cause) {
      if (left === 0 || !busy(cause)) throw cause;
      onWait?.(seconds);
      await after(seconds * 1000);
    }
  }
}
