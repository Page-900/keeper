import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CHECKS, PASSED, render, report } from '../scripts/checks.js';

const PACKAGE = new URL('../package.json', import.meta.url);

const everyCheckPassed = (): Map<string, { status: string }> =>
  new Map(CHECKS.map((check) => [check.id, { status: PASSED }]));

const scripts = (): Record<string, string> => {
  const manifest: unknown = JSON.parse(readFileSync(PACKAGE, 'utf8'));
  return (manifest as { scripts: Record<string, string> }).scripts;
};

const chainedScripts = (): string[] =>
  [...(scripts()['ci'] ?? '').matchAll(/npm run ([\w:]+)/g)].map((match) => match[1] ?? '');

const solidityTests = (): string[] =>
  readdirSync(new URL('../contracts/test/', import.meta.url)).filter((file) =>
    file.endsWith('.t.sol'),
  );

describe('the operator can read what passed and what did not', () => {
  it('calls a run verified only when every declared check passed', () => {
    expect(report(everyCheckPassed()).verified).toBe(true);
  });

  it('prints a check that never ran as a failure rather than leaving it out', () => {
    const partial = everyCheckPassed();
    partial.delete('tests');

    const summary = report(partial);

    expect(summary.verified).toBe(false);
    expect(render(summary)).toMatch(/NOT RUN\s+Tests/);
    expect(render(summary)).toContain('NOT VERIFIED');
  });

  it('explains its own failure in plain words when no developer tool speaks for it', () => {
    const ownVoice = CHECKS.filter((check) => check.script === undefined);

    expect(ownVoice.length).toBeGreaterThan(0);
    for (const check of ownVoice) expect(check.whenFailed).toBeTypeOf('string');
  });

  it('shows every declared check on the table, so no row can be hidden', () => {
    const table = render(report(everyCheckPassed()));

    for (const check of CHECKS) expect(table).toContain(check.title);
  });
});

describe('one command covers the whole chain, so a green table means a green build', () => {
  it('checks everything the fail fast developer chain checks', () => {
    const covered = CHECKS.map((check) => check.script);

    expect(chainedScripts().length).toBeGreaterThan(0);
    for (const script of chainedScripts()) expect(covered).toContain(script);
  });

  it('names every contract test file in a script, so a new one cannot go unrun', () => {
    const named = `${scripts()['test:contracts'] ?? ''} ${scripts()['test:fork'] ?? ''}`;

    expect(solidityTests().length).toBeGreaterThan(0);
    for (const file of solidityTests()) expect(named).toContain(file);
  });
});
