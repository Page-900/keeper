import { readFileSync } from 'node:fs';

import { EVIDENCE_DOC, evidence, writeEvidence } from '../dist/evidence.js';

const print = (text) => process.stdout.write(`${text}\n`);
const before = (() => {
  try {
    return readFileSync(EVIDENCE_DOC, 'utf8');
  } catch {
    return '';
  }
})();

print('');
print('Writing what was actually run, read from the records each run captured.');
print('');

const after = evidence();
writeEvidence();
print(
  before === after
    ? '  EVIDENCE.md was already current.'
    : '  EVIDENCE.md rewritten from the records.',
);
print('');
