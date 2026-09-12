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
  waitFor,
  EXPLORER_TX,
} from './ui.js';
import { growBox, startAgain, wireChat } from './chat.js';
import { wirePanel } from './live.js';

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

const boundRow = (one) => {
  const row = el('li');
  const figure = put(
    el('span', one.well ? 'b-fig b-ok' : 'b-fig'),
    el('span', undefined, one.figure),
  );
  if (one.aside !== null) put(figure, el('em', undefined, ` ${one.aside}`));
  return put(row, figure, el('span', 'b-say', one.say));
};

const showBound = (bound) => {
  const box = clear(find('brief'));
  for (const one of bound) put(box, boundRow(one));
};

const showState = (state) => {
  find('loading').remove();
  find('run').disabled = false;
  find('blockNow').textContent = state.blockNumber;
  lines(find('scenario'), state.scenario);
  counted('situationCount', state.scenario.length);
  lines(find('mandate'), state.mandate);
  lines(find('policy'), state.policy);
  showBound(state.bound);
  find('document').value = state.document;
  growBox(find('document'));

  showHolders(state);

  put(clear(find('evidence')), evidenceRows(state.evidence));
  put(clear(find('authorityTable')), evidenceRows(state.authority));
  counted('refusalCount', state.evidence.length);
  counted('authorityCount', state.authority.length);
};

const whatItSent = (done) => {
  const line = el('p', 'when');
  if (done.sent !== true) return put(line, el('span', undefined, `Not sent: ${done.because}`));
  put(line, el('span', undefined, 'Sent: '));
  return put(line, link(`${EXPLORER_TX}${done.transactionHash}`, shortened(done.transactionHash)));
};

const HISTORY = 40;

const attemptCard = (record) => {
  const acted = record.verdict !== null;
  const box = el('div', record.verdict === 'refused' ? 'card held' : 'card');
  put(box, el('h3', undefined, acted ? (VERDICT[record.verdict] ?? record.verdict) : 'Answered'));
  put(box, el('p', 'when', new Date(record.at).toUTCString()));
  put(box, el('p', undefined, proposal(record.intent)));
  if (record.delivered !== null && record.delivered !== undefined)
    put(box, whatItSent(record.delivered));
  for (const refusal of record.refusals)
    put(box, el('p', 'note', `${refusal.rule}, refused by the ${refusal.source}.`));
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
  for (const record of answer.body.slice(0, HISTORY)) put(listing, attemptCard(record));
  return listing;
};

const trouble = (heading, text) => {
  const note = find('loading');
  note.className = 'card watch';
  clear(note);
  put(note, el('h3', undefined, heading), el('p', undefined, text));
  find('run').disabled = false;
  find('blockNow').textContent = 'not read';
  clear(find('brief'));
  put(find('brief'), put(el('li'), el('span', 'b-say', 'The chain could not be read just now.')));
  find('document').placeholder = 'The offering document could not be read, so write your own.';
};

const NOT_FROM_MEMORY =
  'Nothing on this page is filled in from memory, so it shows you nothing rather than something stale.';

const PANELS = () => Array.from(document.querySelectorAll('main > .panel, main > .drop'));

const FIRST = 'attack';

const showPanel = (wanted) => {
  const panels = PANELS();
  const known = panels.some((panel) => panel.id === wanted);
  const chosen = known ? wanted : FIRST;
  for (const panel of panels) panel.hidden = panel.id !== chosen;
  for (const link of document.querySelectorAll('.railList a'))
    link.className = link.getAttribute('href') === `#${chosen}` ? 'here' : '';
  return chosen;
};

/** One panel at a time, chosen by the rail, so nothing is findable only by scrolling. */
const watchRail = () => {
  showPanel(window.location.hash.slice(1));
  window.addEventListener('hashchange', () => {
    showPanel(window.location.hash.slice(1));
    window.scrollTo({ top: 0 });
  });
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

const askedAnswer = (answer) => {
  const body = answer.body;
  if (answer.status !== 200)
    return {
      tone: 'trouble',
      head: saidBy(answer) + waitFor(body.retryAfterSeconds),
      lines: [],
    };
  return {
    tone: body.allowed ? 'allowed' : 'refused',
    head: body.allowed ? 'Allowed' : (body.refusal?.error ?? 'Refused'),
    lines: [body.says, `Read at block ${body.atBlock}.`],
  };
};

const showAsked = (answer, address) => {
  const box = clear(find('yoursAnswer'));
  const shown = askedAnswer(answer);
  box.dataset.tone = shown.tone;
  put(box, el('p', 'yoursHead', shown.head));
  const list = el('ul', 'lines tight');
  for (const text of shown.lines) put(list, el('li', undefined, text));
  put(box, list);
  if (typeof answer.body.explorer === 'string')
    put(box, put(el('p', 'note'), link(answer.body.explorer, `Look up ${shortened(address)}`)));
};

const wireYours = () => {
  const form = find('yoursForm');
  const input = find('yoursInput');
  const button = find('yoursButton');
  const box = find('checkBox');
  find('checkOpen').addEventListener('click', () => {
    box.showModal();
    input.focus();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const address = input.value.trim();
    button.disabled = true;
    put(
      clear(find('yoursAnswer')),
      el('span', 'spinner'),
      el('span', undefined, 'Asking the chain'),
    );
    void ask('/api/recipient', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address }),
    })
      .then((answer) => {
        showAsked(answer, address);
      })
      .catch(() => {
        clear(find('yoursAnswer')).textContent = 'This page could not reach its own server.';
      })
      .finally(() => {
        button.disabled = false;
      });
  });
};

const bidCard = (bid) => {
  const box = el('div', 'bidCard');
  put(box, el('h3', undefined, bid.title));
  put(box, el('p', 'note', bid.says));
  put(box, el('pre', 'bidText', bid.document));
  const use = el('button', 'ghost', 'Put it in the box');
  use.type = 'button';
  use.addEventListener('click', () => {
    void startAgain();
    const said = find('document');
    said.value = bid.document;
    window.location.hash = '#attack';
    said.focus();
    said.setSelectionRange(0, 0);
    window.requestAnimationFrame(() => {
      growBox(said);
      said.scrollTop = 0;
    });
    use.textContent = 'In the box';
    window.setTimeout(() => {
      use.textContent = 'Put it in the box';
    }, 1600);
  });
  return put(box, use);
};

const showBids = async () => {
  const listing = clear(find('bidList'));
  const answer = await ask('/api/bids');
  if (answer.status !== 200) return put(listing, el('p', 'note', saidBy(answer)));
  counted('bidCount', answer.body.length);
  for (const bid of answer.body) put(listing, bidCard(bid));
  return listing;
};

const start = async () => {
  wireChat(() => showAttempts(), wirePanel());
  wireYours();
  foldRail();
  dragRail();
  watchRail();
  void showBids();
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
