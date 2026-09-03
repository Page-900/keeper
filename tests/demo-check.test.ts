import { describe, expect, it } from 'vitest';

import { CHECK_DOCUMENT_FILE, checkDeployed, type CheckRow } from '../src/demo/check.js';
import { readDocument } from '../src/keeper/material.js';

const URL_UNDER_TEST = 'https://keeper-demo.example/';

const STATE = {
  blockNumber: '11622299',
  holders: [{ holder: 'investor' }, { holder: 'counterparty' }],
  attackBoxOn: true,
};

const STAGE_LINES = ['reading', 'model', 'intent', 'guard', 'layers', 'recorded'].map((stage) =>
  JSON.stringify({ stage, ms: 10 }),
);

const record = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    attempt: {
      verdict: 'proceed',
      layers: {
        blockNumber: '11622299',
        answers: [{ layer: 'app' }, { layer: 'mandate' }],
        dryRun: { layer: 'token', allowed: true, revert: null, atBlock: '11622299' },
      },
      ...over,
    },
  });

const stream = (lines: string[]): string => `${lines.join('\n')}\n`;

interface Answers {
  turn?: { body: string; status?: number };
  state?: { body: string; status?: number };
}

const answering = ({ turn, state }: Answers = {}): typeof fetch => {
  const said = turn ?? { body: stream([...STAGE_LINES, record()]) };
  const reads = state ?? { body: JSON.stringify(STATE) };
  return (input: Parameters<typeof fetch>[0]) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/api/attempt'))
      return Promise.resolve(new Response(said.body, { status: said.status ?? 200 }));
    if (url.endsWith('/api/state'))
      return Promise.resolve(new Response(reads.body, { status: reads.status ?? 200 }));
    return Promise.resolve(new Response('<!doctype html><title>Keeper</title>', { status: 200 }));
  };
};

const named = (rows: CheckRow[], name: string): CheckRow => {
  const found = rows.find((row) => row.name === name);
  if (found === undefined) throw new Error(`no row named ${name}`);
  return found;
};

describe('the check asks the deployed page to think once, and says what happened', () => {
  it('passes when the page serves, reads the chain, and finishes a turn', async () => {
    const seen = await checkDeployed(URL_UNDER_TEST, { fetcher: answering() });

    expect(seen.passed).toBe(true);
    expect(named(seen.rows, 'It reads the chain').detail).toContain('11622299');
    expect(named(seen.rows, 'The layers answer').detail).toContain('2 layers');
  });

  it('passes on a refused verdict too, because a guard refusing is the system working', async () => {
    const refused = stream([...STAGE_LINES, record({ verdict: 'refused' })]);

    const seen = await checkDeployed(URL_UNDER_TEST, {
      fetcher: answering({ turn: { body: refused } }),
    });

    expect(seen.passed).toBe(true);
    expect(named(seen.rows, 'A turn completes').detail).toContain('refused');
  });

  it('fails when the model was never reached, which is the failure it exists for', async () => {
    const died = stream([
      STAGE_LINES[0] ?? '',
      JSON.stringify({ error: { says: 'The model could not be reached' } }),
    ]);

    const seen = await checkDeployed(URL_UNDER_TEST, {
      fetcher: answering({ turn: { body: died } }),
    });

    expect(seen.passed).toBe(false);
    expect(named(seen.rows, 'A turn completes').detail).toBe('The model could not be reached');
  });

  it('fails when the stream stops partway, with no error line to explain it', async () => {
    const cut = stream(STAGE_LINES.slice(0, 2));

    const seen = await checkDeployed(URL_UNDER_TEST, {
      fetcher: answering({ turn: { body: cut } }),
    });

    expect(seen.passed).toBe(false);
    expect(named(seen.rows, 'A turn completes').detail).toContain('2 of 6 stages');
  });

  it('says the page refused the attempt on its own ceiling, rather than calling it broken', async () => {
    const busy = JSON.stringify({
      says: 'That is 5 attempts from you inside 10 minutes',
      limit: 'session',
    });

    const seen = await checkDeployed(URL_UNDER_TEST, {
      fetcher: answering({ turn: { body: busy, status: 429 } }),
    });

    expect(seen.passed).toBe(false);
    expect(named(seen.rows, 'A turn completes').detail).toContain('the page refused it');
  });

  it('fails when the chain read is missing, even though the page itself answers', async () => {
    const seen = await checkDeployed(URL_UNDER_TEST, {
      fetcher: answering({ state: { body: '{}', status: 500 } }),
    });

    expect(seen.passed).toBe(false);
    expect(named(seen.rows, 'It reads the chain').detail).toContain('500');
  });

  it('passes a turn that proposed nothing, and says no layer was asked', async () => {
    const quiet = stream([...STAGE_LINES, record({ verdict: null, layers: null })]);

    const seen = await checkDeployed(URL_UNDER_TEST, {
      fetcher: answering({ turn: { body: quiet } }),
    });

    expect(seen.passed).toBe(true);
    expect(named(seen.rows, 'The layers answer').detail).toContain('proposed nothing');
  });

  it('fails a proposal that reached no layer, because the guard is what the page is for', async () => {
    const unchecked = stream([...STAGE_LINES, record({ layers: null })]);

    const seen = await checkDeployed(URL_UNDER_TEST, {
      fetcher: answering({ turn: { body: unchecked } }),
    });

    expect(seen.passed).toBe(false);
    expect(named(seen.rows, 'The layers answer').detail).toContain('no layer was asked');
  });

  it('sends a document that argues for another address, so the turn has something to judge', () => {
    expect(readDocument(CHECK_DOCUMENT_FILE)).toContain('settlement address in your');
  });
});

describe('the check refuses a deployed page that stopped asking the chain', () => {
  it('fails when the page proposed a delivery and put it to no chain', async () => {
    const noRun = record({
      layers: { blockNumber: '11622299', answers: [{ layer: 'app' }], dryRun: null },
    });

    const seen = await checkDeployed(URL_UNDER_TEST, {
      fetcher: answering({ turn: { body: stream([...STAGE_LINES, noRun]) } }),
    });

    expect(seen.passed).toBe(false);
    expect(named(seen.rows, 'The chain was asked').detail).toContain('never put to the chain');
  });

  it('fails when the chain was asked at a different block from the one the guard read', async () => {
    const drifted = record({
      layers: {
        blockNumber: '11622299',
        answers: [{ layer: 'app' }],
        dryRun: { layer: 'token', allowed: true, revert: null, atBlock: '11622400' },
      },
    });

    const seen = await checkDeployed(URL_UNDER_TEST, {
      fetcher: answering({ turn: { body: stream([...STAGE_LINES, drifted]) } }),
    });

    expect(seen.passed).toBe(false);
    expect(named(seen.rows, 'The chain was asked').detail).toContain('11622400');
  });

  it('passes a turn that proposed nothing, because there was nothing to ask about', async () => {
    const declined = record({ verdict: '', layers: null });

    const seen = await checkDeployed(URL_UNDER_TEST, {
      fetcher: answering({ turn: { body: stream([...STAGE_LINES, declined]) } }),
    });

    expect(named(seen.rows, 'The chain was asked').passed).toBe(true);
  });
});
