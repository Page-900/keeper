import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { setTimeout as after } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const DEMO_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'demo.js');

const START_MS = 30_000;

const READ_MS = 60_000;

const PORT_LINE = /http:\/\/localhost:(\d+)/;

const LATE = { late: true };

const SAMPLE = 'A check of the page itself, which is neither an offering nor an attack.';

const VISITORS = ['198.51.100.1', '198.51.100.2', '198.51.100.3'];

const pageEnv = async () => {
  const { OFF_SWITCH } = await import('../dist/demo/limits.js');
  const kept = Object.entries(process.env).filter(([name]) => name !== OFF_SWITCH);
  return { ...Object.fromEntries(kept), PORT: '0' };
};

const startedPage = async (extra) => {
  const child = spawn(process.execPath, [DEMO_SCRIPT], { env: { ...(await pageEnv()), ...extra } });
  let said = '';
  const printed = new Promise((resolve) => {
    const watch = (part) => {
      said += String(part);
      const found = PORT_LINE.exec(said);
      if (found !== null) resolve({ port: Number(found[1]) });
    };
    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
  });
  const outcome = await Promise.race([
    printed,
    once(child, 'exit').then(([code]) => ({ stopped: String(code) })),
    /** Unreferenced, so a race the page has already won leaves nothing holding the run open. */
    after(START_MS, LATE, { ref: false }),
  ]);
  if (outcome.port === undefined) {
    child.kill();
    const why =
      outcome.late === true ? `nothing in ${START_MS / 1000} seconds` : `code ${outcome.stopped}`;
    throw new Error(`The page did not start, ${why}. ${said}`);
  }
  return { port: outcome.port, stop: () => child.kill() };
};

const usingPage = async (extra, run) => {
  const page = await startedPage(extra);
  try {
    return await run(page.port);
  } finally {
    page.stop();
  }
};

const asked = async (port, path, init = {}) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    signal: AbortSignal.timeout(READ_MS),
    ...init,
  }).catch((cause) => {
    throw new Error(`Nothing answered at ${path} on port ${port}. ${cause.message}`);
  });
  return { status: response.status, text: await response.text() };
};

const served = async (port, path) => {
  const answer = await asked(port, path);
  if (answer.status !== 200) throw new Error(`${path} answered ${answer.status}. ${answer.text}`);
  if (answer.text.trim() === '') throw new Error(`${path} answered with nothing in it.`);
  return answer.text;
};

const attemptFrom = (port, visitor) =>
  asked(port, '/api/attempt', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': visitor },
    body: JSON.stringify({ say: SAMPLE }),
  });

const refusedAs = (answer, limit) => {
  if (answer.status !== 429)
    throw new Error(`An attempt that had to be refused was answered ${answer.status}.`);
  const body = JSON.parse(answer.text);
  if (body.limit !== limit)
    throw new Error(`It was refused on the ${body.limit} limit rather than the ${limit} one.`);
  return body;
};

const WARM_MS = 1_000;

const confirmPageCold = async () => {
  const started = Date.now();
  return usingPage({}, async (port) => {
    const state = JSON.parse(await served(port, '/api/state'));
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const asAgain = Date.now();
    await served(port, '/api/state');
    const warm = Date.now() - asAgain;
    for (const path of ['/', '/style.css', '/app.js', '/api/evidence', '/api/attempts'])
      await served(port, path);
    if (!state.attackBoxOn)
      throw new Error('The page reports its attack box off, and nothing switched it off.');
    if (state.holders.length === 0)
      throw new Error(
        state.holdersRead === false
          ? 'The page is up and reading the chain, but the issuer records could not be read, so it shows no cap table. Check whether we are inside their rate limit before reading this as a broken page.'
          : 'The page names no holder of the token.',
      );
    const shown = state.evidence.length + state.authority.length;
    if (shown === 0) throw new Error('The page shows no evidence at all.');
    if (warm > WARM_MS)
      throw new Error(
        `A visitor arriving once the page was up waited ${warm} milliseconds, and the answer is meant to be in hand already.`,
      );
    return `A new process served the page and read the chain in ${seconds} seconds, at block ${state.blockNumber}, with ${state.holders.length} holders and ${shown} transactions. A visitor arriving after that was served in ${warm} milliseconds.`;
  });
};

const unread = () => {
  throw new Error('This check asks the page for nothing but its ceilings.');
};

const ANSWERED = Object.freeze({
  at: '',
  id: 'none',
  said: SAMPLE,
  answer: 'It declined, and nothing moved.',
  reasoning: '',
  intent: { action: 'hold', amount: '0', pricePerToken: '0', recipient: null, rationale: '' },
  verdict: 'refuse',
  refusals: [],
  layers: {},
});

const floodSources = (limits) => ({
  reads: { state: unread, balance: unread },
  capTable: unread,
  ramsStatus: unread,
  attempt: () => Promise.resolve(ANSWERED),
  limits,
});

const listening = async (server) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
};

const confirmPageFlood = async () => {
  const { demoServer } = await import('../dist/demo/server.js');
  const { ATTEMPTS_PER_DAY, ATTEMPTS_PER_SESSION, createLimits } =
    await import('../dist/demo/limits.js');
  const limits = (spentToday) =>
    createLimits({ spentOn: () => spentToday, switchedOff: () => false });
  const fresh = demoServer(floodSources(limits(0)));
  const spent = demoServer(floodSources(limits(ATTEMPTS_PER_DAY)));
  try {
    const port = await listening(fresh);
    for (let sent = 1; sent <= ATTEMPTS_PER_SESSION; sent += 1) {
      const answer = await attemptFrom(port, VISITORS[0]);
      if (answer.status !== 200)
        throw new Error(
          `Attempt ${sent} of the ${ATTEMPTS_PER_SESSION} a visitor may run was answered ${answer.status}.`,
        );
    }
    const over = refusedAs(await attemptFrom(port, VISITORS[0]), 'session');
    if (typeof over.retryAfterSeconds !== 'number' || over.retryAfterSeconds <= 0)
      throw new Error('The refusal does not tell the visitor when they may try again.');
    const other = await attemptFrom(port, VISITORS[1]);
    if (other.status !== 200)
      throw new Error(
        `A second visitor was answered ${other.status}, and the ceiling is one visitor's.`,
      );
    refusedAs(await attemptFrom(await listening(spent), VISITORS[2]), 'daily');
  } finally {
    for (const server of [fresh, spent]) {
      server.closeAllConnections();
      server.close();
    }
  }
  return `${ATTEMPTS_PER_SESSION} attempts from one visitor were served and the next was refused, a second visitor was still served, and a page that has already run its ${ATTEMPTS_PER_DAY} for the day refused a first attempt.`;
};

const confirmPageSwitch = async () => {
  const { OFF_SWITCH } = await import('../dist/demo/limits.js');
  return usingPage({ [OFF_SWITCH]: '1' }, async (port) => {
    await served(port, '/');
    const state = JSON.parse(await served(port, '/api/state'));
    if (state.attackBoxOn)
      throw new Error('The switch is set and the page still reports its attack box on.');
    refusedAs(await attemptFrom(port, VISITORS[0]), 'off');
    return `With the switch set the page still serves and still reads the chain, at block ${state.blockNumber}, and an attempt was refused before the model was reached.`;
  });
};

const ON_CHAIN = Object.freeze({ allowed: 'success', refused: 'reverted' });

const confirmPageHashes = async () => {
  const { authorityTable, evidenceTable } = await import('../dist/demo/view.js');
  const { transactionReceipt } = await import('../dist/chain/client.js');
  const rows = [...evidenceTable(), ...authorityTable()];
  if (rows.length === 0) throw new Error('The page shows no transaction at all.');
  for (const row of rows) {
    if (!row.explorer.includes(row.transactionHash))
      throw new Error(`The link beside ${row.transactionHash} does not point at it.`);
    const receipt = await transactionReceipt(row.transactionHash);
    if (receipt.status !== ON_CHAIN[row.outcome])
      throw new Error(
        `The page calls ${row.transactionHash} ${row.outcome}, and the chain reads it as ${receipt.status}.`,
      );
    if (String(receipt.blockNumber) !== row.blockNumber)
      throw new Error(
        `The page puts ${row.transactionHash} in block ${row.blockNumber}, and the chain has it in ${receipt.blockNumber}.`,
      );
  }
  const allowed = rows.filter((row) => row.outcome === 'allowed').length;
  return `${rows.length} transactions the page shows are on the chain in the block it names, ${allowed} that went through and ${rows.length - allowed} that were refused.`;
};

export const PAGE_RUNNERS = {
  pageCold: confirmPageCold,
  pageFlood: confirmPageFlood,
  pageSwitch: confirmPageSwitch,
  pageHashes: confirmPageHashes,
};
