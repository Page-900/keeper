import { KeeperError } from '../../src/shared/errors.js';

export async function captureError(run: () => Promise<unknown>): Promise<KeeperError> {
  try {
    await run();
  } catch (cause) {
    if (cause instanceof KeeperError) return cause;
    throw cause;
  }
  throw new Error('expected a KeeperError');
}
