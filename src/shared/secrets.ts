import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';

import { KeeperError } from './errors.js';

/** Resolved from this module, so the file cannot follow the working directory. */
const ENV_FILE = fileURLToPath(new URL('../../.env', import.meta.url));
const REDACTED = '[redacted]';

const known = new Set<string>();
let envFileLoaded = false;

/** Node never overwrites a variable that is already set, so a stubbed test env survives this. */
function loadEnvFileOnce(): void {
  if (envFileLoaded) return;
  envFileLoaded = true;
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
}

function remember(value: string): void {
  known.add(value);
  if (!/^0x[0-9a-fA-F]+$/.test(value)) return;
  known.add(value.slice(2));
  // viem prints an out-of-range private key back as a decimal integer.
  known.add(BigInt(value).toString(10));
}

const asPattern = (value: string): RegExp =>
  new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');

export function readOptionalSecret(name: string): string | undefined {
  loadEnvFileOnce();
  const value = process.env[name];
  if (value === undefined || value === '') return undefined;
  remember(value);
  return value;
}

export function readSecret(name: string): string {
  const value = readOptionalSecret(name);
  if (value === undefined) throw new KeeperError('secretMissing', name);
  return value;
}

export function scrub(text: string): string {
  let clean = text;
  for (const value of known) clean = clean.replace(asPattern(value), REDACTED);
  return clean;
}

const describe = (cause: unknown): string =>
  cause instanceof Error ? `${cause.name}: ${cause.message}` : inspect(cause);

/** Discarded, not repaired: a viem error repeats its text in fields a caller can print. */
export function scrubError(cause: unknown): Error {
  const scrubbed =
    cause instanceof KeeperError
      ? new KeeperError(cause.kind, scrub(cause.detail))
      : new Error(scrub(describe(cause)));
  if (cause instanceof Error && cause.stack !== undefined) scrubbed.stack = scrub(cause.stack);
  return scrubbed;
}

export async function withoutSecrets<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    throw scrubError(cause);
  }
}
