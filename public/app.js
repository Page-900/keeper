import {
  VERDICT,
  LAYER,
  proposal,
  el,
  put,
  clear,
  find,
  link,
  shortened,
  lines,
  table,
  cell,
  stamped,
  ask,
  saidBy,
} from './ui.js';
import { growBox, wireChat } from './chat.js';

const evidenceRows = (rows) =>
  table(
    ['what happened', 'outcome', 'layer', 'reason', 'block', 'transaction'],
    rows.map((row) => [
      cell(row.claim),
      stamped(row.outcome),
      cell(LAYER[row.layer] ?? row.layer, 'layerCol'),
      cell(row.reason ?? 'none', 'tag'),
      cell(row.blockNumber, 'figure'),
      put(el('td', 'tag'), link(row.explorer, shortened(row.transactionHash))),
    ]),
  );

const counted = (id, total) => {
  find(id).textContent = String(total);
};

const NO_RECORDS =
  'The issuer’s own records could not be read just now, so this shows nothing rather than something stale.';

const showHolders = (state) => {
  const holders = clear(find('holderTable'));
  const agreement = clear(find('agreement'));
  if (!state.holdersRead) {
    put(holders, el('p', 'note', NO_RECORDS));
    return;
  }
  put(
    holders,
    table(
      ['holder', 'the chain says', 'the issuer says', 'cleared to hold', 'wallet'],
      state.holders.map((holder) => [
        cell(holder.label),
        cell(holder.onChain, 'figure'),
        cell(holder.reported, 'figure'),
        cell(holder.cleared ? 'yes' : 'no'),
        put(el('td', 'tag'), link(holder.explorer, shortened(holder.wallet))),
      ]),
    ),
  );
  put(
    agreement,
    table(
      ['question', 'their contract', 'their records', 'agreed'],
      state.agreement.rows.map((row) => [
        cell(row.what),
        cell(row.chain, 'figure'),
        cell(row.brickken ?? 'not read', 'figure'),
        cell(row.agree === null ? 'unknown' : row.agree ? 'yes' : 'no'),
      ]),
    ),
  );
  put(agreement, el('p', 'note', state.agreement.says));
};

const showState = (state) => {
  find('loading').remove();
  find('run').disabled = false;
  find('blockNow').textContent = state.blockNumber;
  lines(find('scenario'), state.scenario);
  counted('situationCount', state.scenario.length);
  lines(find('mandate'), state.mandate);
  lines(find('policy'), state.policy);
  lines(find('brief'), state.mandate);
  find('document').value = state.document;
  growBox(find('document'));

  showHolders(state);

  put(clear(find('evidence')), evidenceRows(state.evidence));
  put(clear(find('authorityTable')), evidenceRows(state.authority));
  counted('refusalCount', state.evidence.length);
  counted('authorityCount', state.authority.length);
};

const attemptCard = (record) => {
  const acted = record.verdict !== null;
  const box = el('div', record.verdict === 'refused' ? 'card held' : 'card');
  put(box, el('h3', undefined, acted ? (VERDICT[record.verdict] ?? record.verdict) : 'Answered'));
  put(box, el('p', 'when', new Date(record.at).toUTCString()));
  put(box, el('p', undefined, proposal(record.intent)));
  const words = put(el('details', 'trace'), el('summary', undefined, 'What they wrote'));
  const text = el('pre', undefined, 'Reading it...');
  let read = false;
  words.addEventListener('toggle', () => {
    if (!words.open || read) return;
    read = true;
    put(words, text);
    fetch(`/api/attempts/${record.id}`)
      .then((answer) => answer.text())
      .then((body) => {
        text.textContent = body;
      })
      .catch(() => {
        text.textContent = 'Their words could not be read just now.';
      });
  });
  return put(box, words);
};

const showAttempts = async () => {
  const listing = clear(find('attempts'));
  const answer = await ask('/api/attempts');
  if (answer.status !== 200) return put(listing, el('p', 'note', saidBy(answer)));
  counted('attemptCount', answer.body.length);
  if (answer.body.length === 0)
    return put(listing, el('p', 'note', 'Nobody has tried it yet. You would be the first.'));
  for (const record of answer.body.slice(0, 10)) put(listing, attemptCard(record));
  return listing;
};

const trouble = (heading, text) => {
  const note = find('loading');
  note.className = 'card watch';
  clear(note);
  put(note, el('h3', undefined, heading), el('p', undefined, text));
  find('run').disabled = false;
  find('blockNow').textContent = 'not read';
  lines(find('brief'), ['The chain could not be read just now, so nothing is shown here.']);
  find('document').placeholder = 'The offering document could not be read, so write your own.';
};

const NOT_FROM_MEMORY =
  'Nothing on this page is filled in from memory, so it shows you nothing rather than something stale.';

const watchRail = () => {
  const links = Array.from(document.querySelectorAll('.railList a'));
  const spy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const one of links) one.className = '';
        const here = links.find((one) => one.getAttribute('href') === `#${entry.target.id}`);
        if (here !== undefined) here.className = 'here';
      }
    },
    { rootMargin: '-10% 0px -70% 0px' },
  );
  for (const one of links) {
    const target = find(one.getAttribute('href').slice(1));
    if (target !== null) spy.observe(target);
  }
};

const RAIL_MIN = 168;
const RAIL_MAX = 340;

const shellNode = () => document.querySelector('.shell');

const setRail = (width) => {
  document.documentElement.style.setProperty('--rail-w', width);
};

const foldRail = () => {
  const button = find('fold');
  let chosen = '';
  button.addEventListener('click', () => {
    const folded = shellNode().classList.toggle('folded');
    if (folded) chosen = document.documentElement.style.getPropertyValue('--rail-w');
    setRail(folded ? '3.4rem' : chosen);
    button.title = folded ? 'Open the menu' : 'Collapse the menu';
  });
};

const dragRail = () => {
  const grip = find('grip');
  grip.addEventListener('pointerdown', (event) => {
    grip.setPointerCapture(event.pointerId);
    shellNode().classList.add('dragging');
  });
  grip.addEventListener('pointermove', (event) => {
    if (!grip.hasPointerCapture(event.pointerId)) return;
    const from = shellNode().getBoundingClientRect().left;
    const wide = Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(event.clientX - from)));
    setRail(`${String(wide)}px`);
  });
  grip.addEventListener('pointerup', (event) => {
    grip.releasePointerCapture(event.pointerId);
    shellNode().classList.remove('dragging');
  });
};

const start = async () => {
  wireChat(() => showAttempts());
  foldRail();
  dragRail();
  watchRail();
  try {
    const answer = await ask('/api/state');
    if (answer.status === 200) showState(answer.body);
    else
      trouble(
        'This page cannot show you live numbers right now',
        `${saidBy(answer)} ${NOT_FROM_MEMORY}`,
      );
    await showAttempts();
  } catch {
    trouble('This page cannot reach its own server', NOT_FROM_MEMORY);
  }
};

void start();
