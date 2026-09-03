import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP_ROOT = new URL('../', import.meta.url);
const DOCKERFILE = readFileSync(new URL('Dockerfile', APP_ROOT), 'utf8');
const DOCKERIGNORE = readFileSync(new URL('.dockerignore', APP_ROOT), 'utf8');

const ENTRIES = ['src/demo/server.ts', 'src/demo/sources.ts'];

const sourceOf = (file: URL): string => readFileSync(file, 'utf8');

const specifiers = (text: string): string[] =>
  text
    .split(';')
    .filter((part) => part.includes('import') && !/import\s+type\s/.test(part))
    .flatMap((part) => [...part.matchAll(/from\s+'(\.[^']+)'/g)].map((found) => found[1] ?? ''));

function reachedFrom(entries: readonly string[]): URL[] {
  const seen = new Map<string, URL>();
  const queue = entries.map((entry) => new URL(entry, APP_ROOT));
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file.href)) continue;
    seen.set(file.href, file);
    for (const specifier of specifiers(sourceOf(file)))
      queue.push(new URL(specifier.replace(/\.js$/, '.ts'), file));
  }
  return [...seen.values()];
}

/** A template literal is resolved as far as its literal head, which is all a directory needs. */
const resolvedPaths = (text: string, file: URL): string[] =>
  [...text.matchAll(/new URL\(\s*['`](\.\.?\/[^'`$]*)/g)].map((found) =>
    decodeURIComponent(new URL(found[1] ?? '', file).href.slice(APP_ROOT.href.length)),
  );

const directoriesRead = (): string[] => {
  const found = new Set<string>();
  for (const file of reachedFrom(ENTRIES))
    for (const path of resolvedPaths(sourceOf(file), file)) {
      const [directory, ...rest] = path.split('/');
      if (directory !== undefined && directory !== '' && rest.length > 0) found.add(directory);
    }
  return [...found].sort();
};

const copiedIn = (directory: string): boolean =>
  new RegExp(String.raw`^COPY[^\n]*\s${directory}\s`, 'm').test(DOCKERFILE) ||
  new RegExp(String.raw`^COPY[^\n]*/${directory}\s`, 'm').test(DOCKERFILE);

describe('the image carries everything the published page reaches for', () => {
  it('finds the directories the page reads, rather than trusting a list', () => {
    expect(directoriesRead()).toContain('evidence');
    expect(reachedFrom(ENTRIES).map((file) => fileURLToPath(file)).length).toBeGreaterThan(10);
  });

  it('copies every one of them into the image that is deployed', () => {
    const missing = directoriesRead().filter((directory) => !copiedIn(directory));

    expect(missing).toEqual([]);
  });
});

describe('nothing that signs anything can reach the published image', () => {
  it('keeps the secrets file out of the build context', () => {
    const excluded = DOCKERIGNORE.split(/\r?\n/).map((line) => line.trim());

    expect(excluded).toContain('.env');
    expect(excluded).toContain('.env.*');
  });

  it('runs the page and nothing else, so no script that can sign is in the image', () => {
    expect(DOCKERFILE).toMatch(/^CMD \["node", "scripts\/demo\.js"\]$/m);
    expect(DOCKERFILE).not.toMatch(/^COPY scripts\s/m);
  });
});
