import {
  VERDICT,
  LAYER,
  proposal,
  el,
  put,
  clear,
  find,
  card,
  spoken,
  saidBy,
  waitFor,
} from './ui.js';

const STAGE = {
  reading: 'Reading the chain and the document',
  model: 'Asking the model',
  intent: 'Reading what it proposed',
  guard: 'Checking it against the rules',
  layers: 'Asking the registry',
  recorded: 'Writing it down',
};

const STAGE_ORDER = ['reading', 'model', 'intent', 'guard', 'layers', 'recorded'];

const took = (ms) => (ms < 1000 ? `${String(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

const showWorking = () => {
  const line = clear(find('working'));
  const clock = el('span', 'ms', '0.0 s');
  let label = el('span', 'doing', STAGE[STAGE_ORDER[0]]);
  put(line, el('span', 'tick'), label, clock);
  line.className = 'working live';

  const began = Date.now();
  const ticking = window.setInterval(() => {
    clock.textContent = took(Date.now() - began);
  }, 100);
  let at = 0;

  return {
    landed: () => {
      at += 1;
      if (at >= STAGE_ORDER.length) return;
      const next = el('span', 'doing', STAGE[STAGE_ORDER[at]]);
      line.replaceChild(next, label);
      label = next;
    },
    stop: (answered) => {
      window.clearInterval(ticking);
      clear(line);
      line.className = 'working';
      if (answered)
        put(
          line,
          el('span', 'tick'),
          el('span', 'doing', `Answered in ${took(Date.now() - began)}`),
        );
    },
  };
};

const layerCells = () => Array.from(document.querySelectorAll('.layerCell'));

const setLayers = (state, word) => {
  for (const node of layerCells()) {
    node.className = `layerCell ${state}`;
    const label = node.lastElementChild;
    if (label !== null) label.textContent = word;
  }
};

const VERB = { allows: 'allows', refuses: 'refuses', 'not asked': 'not asked' };

const settleLayers = (answers) => {
  const cells = layerCells();
  answers.forEach((answer, index) => {
    const node = cells.find((cell) => cell.dataset.layer === answer.layer);
    if (node === undefined) return;
    window.setTimeout(() => {
      node.className = `layerCell settled ${answer.verdict === 'refuses' ? 'refuses' : 'allows'}`;
      const label = node.lastElementChild;
      if (label !== null) label.textContent = VERB[answer.verdict] ?? answer.verdict;
    }, index * 220);
  });
};

const layerNote = (answer) => {
  const box = el('div', 'card');
  put(box, el('h3', undefined, `${LAYER[answer.layer] ?? answer.layer}: ${answer.verdict}`));
  for (const because of answer.because) put(box, el('p', undefined, because));
  return box;
};

const youTurn = (text) =>
  put(el('li', 'turn you'), put(el('div', 'bubble'), el('pre', undefined, text)));

const decisionCard = (record) => {
  const box = card(
    record.verdict === 'refused' ? 'card held' : 'card',
    VERDICT[record.verdict] ?? record.verdict,
    [proposal(record.intent)],
  );
  for (const refusal of record.refusals)
    put(
      box,
      el('p', undefined, `${refusal.rule}: ${refusal.detail}, refused by the ${refusal.source}.`),
    );
  return box;
};

const working = (reasoning) => {
  const box = put(el('details', 'trace'), el('summary', undefined, 'Show its private working'));
  return put(box, el('pre', undefined, reasoning));
};

const showTurn = (record) => {
  const box = put(el('li', 'turn keeper'), el('h3', undefined, 'Keeper'));
  put(box, spoken(el('div', 'said'), record.answer));

  if (record.layers === null) {
    setLayers('', 'nothing proposed');
    put(box, el('p', 'note', 'It proposed nothing, so nothing was put to the chain.'));
  } else {
    put(box, decisionCard(record));
    const answers = el('div', 'answers');
    for (const answer of record.layers.answers) put(answers, layerNote(answer));
    put(box, answers);
    settleLayers(record.layers.answers);
    if (typeof record.layers.note === 'string')
      put(box, card('card watch', 'What that means', [record.layers.note]));
  }

  if (record.reasoning !== '') put(box, working(record.reasoning));
  put(find('thread'), box);
  return showLatest(box);
};

const MAX_BOX = 240;

const growBox = (box) => {
  box.style.height = 'auto';
  box.style.height = `${String(Math.min(box.scrollHeight, MAX_BOX))}px`;
};

const showLatest = (turn) => {
  turn.scrollIntoView({ block: 'start' });
};

const notThisTime = (text) => {
  const turn = put(el('li', 'turn'), card('card watch', 'Not this time', [text]));
  put(find('thread'), turn);
  setLayers('', 'idle');
  showLatest(turn);
};

const readStream = async (response, working) => {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let held = '';
  let last = null;
  for (;;) {
    const { done, value } = await reader.read();
    held += done ? '' : decoder.decode(value, { stream: true });
    const parts = held.split('\n');
    held = done ? '' : (parts.pop() ?? '');
    for (const part of parts) {
      if (part === '') continue;
      const message = JSON.parse(part);
      if (typeof message.stage === 'string') working.landed();
      else last = message;
    }
    if (done) return last;
  }
};

const runAttempt = async (afterTurn) => {
  const button = find('run');
  const box = find('document');
  const said = box.value;
  if (said.trim() === '') return;
  button.disabled = true;
  const mine = youTurn(said);
  put(find('thread'), mine);
  box.value = '';
  box.placeholder = 'Say something back';
  growBox(box);
  showLatest(mine);
  setLayers('busy', 'working');
  const working = showWorking();
  let answered = false;
  try {
    const response = await fetch('/api/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ say: said }),
    });
    if (response.status !== 200) {
      const body = await response.json().catch(() => ({}));
      notThisTime(`${saidBy({ body })}${waitFor(body.retryAfterSeconds)}`);
      return;
    }
    const message = await readStream(response, working);
    if (message !== null && message.attempt !== undefined) {
      answered = true;
      showTurn(message.attempt);
    } else if (message !== null && message.error !== undefined)
      notThisTime(`${String(message.error.says)}${waitFor(message.error.retryAfterSeconds)}`);
    else notThisTime('The answer ended before it said anything.');
    try {
      await afterTurn();
    } catch {
      notThisTime('The answer above is real. The log below it could not be refreshed.');
    }
  } catch {
    notThisTime('This page could not reach its own server.');
  } finally {
    working.stop(answered);
    button.disabled = false;
  }
};

export const wireChat = (afterTurn) => {
  find('run').addEventListener('click', () => void runAttempt(afterTurn));
  find('document').addEventListener('input', (event) => {
    growBox(event.target);
  });
};

export { growBox };
