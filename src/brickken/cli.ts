import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { CHAIN_ID, requireAddress } from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { childEnvKeeping } from '../shared/secrets.js';
import { API_KEY_VARIABLE } from './client.js';
import { EVIDENCE_FILE, recorded } from './log.js';

export const CLI_PACKAGE = 'brickken-cli@0.4.12';

const TIMEOUT_MS = 120_000;
const DIRECTORY_WITHOUT_OUR_ENV = tmpdir();
const INSPECT = 'rams inspect';

export interface CliMandate {
  agent: string;
  principal: string;
  asset: string;
  revoked: boolean;
  maxTransactionValue: string;
  maxCumulativeValue: string;
  cumulativeUsed: string;
}

export interface CliReading {
  mandate: CliMandate;
  status: string;
  frozen: boolean;
  nonce: string;
}

function reading(stdout: string, command: string): CliReading {
  const at = stdout.indexOf('{');
  if (at < 0) throw new KeeperError('brickkenUnreadable', `${command} printed no JSON`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(at));
  } catch {
    throw new KeeperError('brickkenUnreadable', `${command} printed something that is not JSON`);
  }
  const found = (parsed ?? {}) as Partial<CliReading>;
  if (found.mandate === undefined)
    throw new KeeperError('brickkenUnreadable', `${command} reported no mandate`);
  return found as CliReading;
}

const runNpx = promisify(execFile);

export const SAFE_ARGUMENT = /^[A-Za-z0-9@._:/-]+$/;

export async function npx(args: string[], keep: readonly string[] = []): Promise<string> {
  const whole = ['-y', CLI_PACKAGE, ...args];
  const unsafe = whole.find((argument) => !SAFE_ARGUMENT.test(argument));
  if (unsafe !== undefined)
    throw new KeeperError('sequenceMalformed', `${unsafe} cannot be passed to a shell`);
  const { stdout } = await runNpx(process.platform === 'win32' ? 'npx.cmd' : 'npx', whole, {
    cwd: DIRECTORY_WITHOUT_OUR_ENV,
    env: childEnvKeeping(keep),
    timeout: TIMEOUT_MS,
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  return stdout;
}

export interface CliRun {
  file?: string;
  run?: (args: string[]) => Promise<string>;
}

const withApiKey = (args: string[]): Promise<string> => npx(args, [API_KEY_VARIABLE]);

export function readMandateOverCli({ file = EVIDENCE_FILE, run = withApiKey }: CliRun = {}) {
  const args = [
    'rams',
    'inspect',
    '--chain',
    String(CHAIN_ID),
    '--agent',
    requireAddress('agent'),
    '--principal',
    requireAddress('principal'),
  ];
  return recorded(
    file,
    { surface: 'cli', method: INSPECT, path: CLI_PACKAGE },
    async (): Promise<CliReading> => reading(await run(args), INSPECT),
  );
}
