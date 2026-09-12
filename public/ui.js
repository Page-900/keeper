const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const put = (parent, ...children) => {
  for (const child of children) parent.appendChild(child);
  return parent;
};

const clear = (node) => {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
  return node;
};

const find = (id) => document.getElementById(id);

const link = (href, text) => {
  if (typeof href !== 'string' || !href.startsWith('https://')) return el('span', undefined, text);
  const anchor = el('a', undefined, text);
  anchor.href = href;
  anchor.rel = 'noreferrer';
  anchor.target = '_blank';
  return anchor;
};

const shortened = (hash) => `${hash.slice(0, 10)}...${hash.slice(-6)}`;

const EXPLORER_TX = 'https://sepolia.etherscan.io/tx/';

const A_HASH = /0x[0-9a-fA-F]{64}/g;

export const hashParts = (text) => {
  const said = String(text);
  const parts = [];
  let at = 0;
  for (const found of said.matchAll(A_HASH)) {
    if (found.index > at) parts.push({ said: said.slice(at, found.index), hash: null });
    parts.push({ said: shortened(found[0]), hash: found[0] });
    at = found.index + found[0].length;
  }
  if (at < said.length) parts.push({ said: said.slice(at), hash: null });
  return parts;
};

const linked = (node, text) => {
  for (const part of hashParts(text))
    put(
      node,
      part.hash === null
        ? el('span', undefined, part.said)
        : link(`${EXPLORER_TX}${part.hash}`, part.said),
    );
  return node;
};

const lines = (node, texts) => {
  clear(node);
  for (const text of texts) put(node, el('li', undefined, text));
};

const PLAIN = [
  [/^\s{0,3}#{1,6}\s+/gm, ''],
  [/^\s{0,3}[-*+]\s+/gm, '• '],
  [/\*\*([^*]+)\*\*/g, '$1'],
  [/__([^_]+)__/g, '$1'],
  [/`([^`]+)`/g, '$1'],
];

const plainWords = (text) =>
  PLAIN.reduce((said, [mark, instead]) => said.replace(mark, instead), text);

const spoken = (node, text) => {
  clear(node);
  for (const line of plainWords(text).split(/\r?\n/))
    if (line.trim() !== '') put(node, linked(el('p'), line.trim()));
  return node;
};

const card = (className, heading, texts) => {
  const box = put(el('div', className), el('h3', undefined, heading));
  for (const text of texts) put(box, linked(el('p'), text));
  return box;
};

const table = (headings, rows) => {
  const head = el('tr');
  for (const heading of headings) put(head, el('th', undefined, heading));
  const body = el('tbody');
  for (const cells of rows) {
    const line = el('tr');
    for (const cell of cells) put(line, cell);
    put(body, line);
  }
  return put(el('div', 'scroll'), put(el('table'), put(el('thead'), head), body));
};

const cell = (text, className) => el('td', className, text);

const stamped = (outcome) =>
  put(el('td'), el('span', outcome === 'refused' ? 'mark-refused' : 'mark-allowed', outcome));

const ask = async (path, init) => {
  const answer = await fetch(path, init);
  const text = await answer.text();
  try {
    return { status: answer.status, body: JSON.parse(text) };
  } catch {
    return { status: answer.status, body: { says: text } };
  }
};

const saidBy = (answer) => {
  const says = answer.body.says;
  return typeof says === 'string' ? says : 'This page could not read the answer it was given.';
};

const waitFor = (seconds) => {
  if (typeof seconds !== 'number') return '';
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1
    ? ' Try again in about a minute.'
    : ` Try again in about ${String(minutes)} minutes.`;
};

export const VERDICT = {
  proceed: 'Every check passed.',
  refused: 'Blocked before anything could move.',
  declined: 'The agent declined to sell.',
};

export const LAYER = {
  app: 'This app',
  mandate: 'The permission',
  token: 'The token',
};

export const proposal = (intent) => {
  if (intent === null) return 'It answered without proposing anything.';
  if (intent.action !== 'deliver') return 'It proposed to sell nothing.';
  const whole = String(BigInt(intent.amount) / 10n ** 18n);
  return `It proposed to sell ${whole} SUNL at ${intent.pricePerToken} BKN each, to ${intent.recipient}.`;
};

export {
  el,
  put,
  clear,
  find,
  link,
  linked,
  shortened,
  EXPLORER_TX,
  lines,
  spoken,
  card,
  table,
  cell,
  stamped,
  ask,
  saidBy,
  waitFor,
};
