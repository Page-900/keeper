import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readOptionalSecret } from '../src/shared/secrets.js';

const startedIn = process.cwd();

afterEach(() => {
  process.chdir(startedIn);
});

describe('the env file is the app root one, whatever the working directory', () => {
  it('ignores a decoy .env planted in the working directory', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'keeper-decoy-'));
    writeFileSync(join(elsewhere, '.env'), 'KEEPER_DECOY_SECRET=loaded-from-the-wrong-file\n');
    process.chdir(elsewhere);

    expect(readOptionalSecret('KEEPER_DECOY_SECRET')).toBeUndefined();
  });
});
