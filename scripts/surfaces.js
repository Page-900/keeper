import { readFileSync } from 'node:fs';

import { SURFACES_FILE, declared, writeDeclaration } from '../dist/surfaces.js';

const print = (text) => process.stdout.write(`${text}\n`);
const before = (() => {
  try {
    return readFileSync(SURFACES_FILE, 'utf8');
  } catch {
    return '';
  }
})();

print('');
print('Writing what this project used of Brickken, read from the evidence it captured.');
print('');

const after = declared();
writeDeclaration();
print(
  before === after
    ? '  SURFACES.md was already current.'
    : '  SURFACES.md rewritten from the evidence.',
);
print('');
