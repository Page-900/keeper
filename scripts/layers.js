import { readFileSync } from 'node:fs';

import { LAYERS_FILE, layers, writeLayers } from '../dist/layers.js';

const print = (text) => process.stdout.write(`${text}\n`);
const before = (() => {
  try {
    return readFileSync(LAYERS_FILE, 'utf8');
  } catch {
    return '';
  }
})();

print('');
print('Writing what each layer is worth, read from the four configurations that were measured.');
print('');

const after = layers();
writeLayers();
print(
  before === after
    ? '  LAYERS.md was already current.'
    : '  LAYERS.md rewritten from the evidence.',
);
print('');
