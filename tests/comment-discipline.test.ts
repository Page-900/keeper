import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));

const COMMENT = /^\s*(\/\/|\/\*|\*)/;
const CASE = /^\s*(it|describe)\(/;
const WIDTH = 100;
const PER_FILE = 10;

const sources = (): string[] =>
  execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', 'src', 'tests', 'scripts', 'public'],
    {
      encoding: 'utf8',
      cwd: APP_ROOT,
    },
  )
    .split('\n')
    .filter((file) => file.endsWith('.ts') || file.endsWith('.js'));

const linesOf = (file: string): string[] => readFileSync(join(APP_ROOT, file), 'utf8').split('\n');

const at = (file: string, index: number): string => `${file}:${String(index + 1)}`;

const blocksOverOneLine = (file: string): string[] => {
  const lines = linesOf(file);
  return lines.flatMap((line, index) =>
    COMMENT.test(line) && index > 0 && COMMENT.test(lines[index - 1] ?? '')
      ? [at(file, index)]
      : [],
  );
};

const linesOverWidth = (file: string): string[] =>
  linesOf(file).flatMap((line, index) =>
    COMMENT.test(line) && line.length > WIDTH ? [at(file, index)] : [],
  );

const restatedCaseNames = (file: string): string[] => {
  const lines = linesOf(file);
  return lines.flatMap((line, index) => {
    const above = lines.slice(0, index).findLast((earlier) => earlier.trim() !== '');
    return CASE.test(line) && above !== undefined && COMMENT.test(above) ? [at(file, index)] : [];
  });
};

const crowdedFiles = (file: string): string[] => {
  const count = linesOf(file).filter((line) => COMMENT.test(line)).length;
  return count > PER_FILE ? [`${file} carries ${String(count)} comment lines`] : [];
};

describe('a comment is a simple phrase, or it is nothing', () => {
  it('runs no comment past a single line', () => {
    expect(sources().flatMap(blocksOverOneLine)).toEqual([]);
  });

  it('keeps every comment inside the width the formatter allows', () => {
    expect(sources().flatMap(linesOverWidth)).toEqual([]);
  });

  it('writes no comment directly above a test case, which already reads as a sentence', () => {
    expect(sources().flatMap(restatedCaseNames)).toEqual([]);
  });

  it('leaves no file so annotated that the code has stopped speaking for itself', () => {
    expect(sources().flatMap(crowdedFiles)).toEqual([]);
  });
});
