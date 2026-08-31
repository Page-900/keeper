import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** One lock across every battery driver, because they all send from the same two wallets. */
export const BATTERY_LOCK = join(tmpdir(), 'keeper-battery.lock');

export interface Held {
  taken: boolean;
  by: string;
}

const holderOf = (file: string): string => {
  try {
    return readFileSync(file, 'utf8').trim() || 'another run';
  } catch {
    return 'another run';
  }
};

export function takeLock(holder: string, file: string = BATTERY_LOCK): Held {
  try {
    const handle = openSync(file, 'wx');
    writeSync(handle, holder);
    closeSync(handle);
    return { taken: true, by: holder };
  } catch {
    return { taken: false, by: holderOf(file) };
  }
}

export function releaseLock(file: string = BATTERY_LOCK): void {
  try {
    unlinkSync(file);
  } catch {
    // already gone, which is the state we wanted
  }
}
