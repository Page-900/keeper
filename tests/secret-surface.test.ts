import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../src/', import.meta.url);

const read = (file: string): string => readFileSync(new URL(file, SRC), 'utf8');

const sourceFiles = (dir = SRC, prefix = ''): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const child = new URL(entry, dir);
    if (statSync(child).isDirectory())
      return sourceFiles(new URL(`${entry}/`, dir), `${prefix}${entry}/`);
    return entry.endsWith('.ts') ? [`${prefix}${entry}`] : [];
  });

const IMPORTED = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'[^']+'/g;

const importedNames = (source: string): Set<string> => {
  const names = new Set<string>();
  for (const match of source.matchAll(IMPORTED))
    for (const raw of (match[1] ?? '').split(',')) {
      const name = raw
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0];
      if (name !== undefined && name !== '') names.add(name);
    }
  return names;
};

/** Every way a value in the env file can be read, written, or handed to a child process. */
const GATED: Record<string, readonly string[]> = {
  readSecret: [
    'brickken/client.ts',
    'brickken/issuer.ts',
    'brickken/mcp.ts',
    'brickken/sdk.ts',
    'chain/client.ts',
    'keeper/model.ts',
  ],
  readOptionalSecret: ['chain/client.ts'],
  readSecretFile: ['chain/client.ts'],
  writeSecret: ['chain/client.ts'],
  childEnvKeeping: ['brickken/cli.ts'],
  signerKey: ['brickken/sdk.ts'],
};

const DECLARES = 'shared/secrets.ts';

describe('a value in the env file is only reachable where it is meant to be reachable', () => {
  it('lets no file import a secret reader unless it is named here', () => {
    const offenders = sourceFiles()
      .filter((file) => file !== DECLARES)
      .flatMap((file) => {
        const names = importedNames(read(file));
        return Object.entries(GATED)
          .filter(([gated, allowed]) => names.has(gated) && !allowed.includes(file))
          .map(([gated]) => `${file} imports ${gated}`);
      });

    expect(offenders).toEqual([]);
  });

  it('keeps no file in the allowance after it has stopped needing it', () => {
    const stale = Object.entries(GATED).flatMap(([gated, allowed]) =>
      allowed
        .filter((file) => !importedNames(read(file)).has(gated))
        .map((file) => `${file} no longer imports ${gated}`),
    );

    expect(stale).toEqual([]);
  });
});
