import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CapTable } from '../src/captable.js';
import type { runTurn } from '../src/demo/attempt.js';
import { createLimits } from '../src/demo/limits.js';
import { createThreads } from '../src/demo/thread.js';
import { type Attempt } from '../src/demo/log.js';
import {
  MAX_BODY_BYTES,
  WAIT_SECONDS,
  demoServer,
  type DemoSources,
  type RamsStatus,
} from '../src/demo/server.js';
import { asRamsStatus } from '../src/demo/sources.js';
import type { GuardReads } from '../src/keeper/guard.js';
import { ERROR_COPY, KeeperError } from '../src/shared/errors.js';
import { SUNL_SYMBOL, requireAddress } from '../src/shared/config.js';
import { appendRecord } from '../src/shared/jsonl.js';
import { captureError } from './support/capture-error.js';
import { registryState } from './support/registry-state.js';

const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));

const STATE = registryState();

const reads: GuardReads = {
  state: () => Promise.resolve(STATE),
  balance: () => Promise.resolve(0n),
};

const capTable = (): CapTable => ({
  token: requireAddress('asset'),
  symbol: SUNL_SYMBOL,
  block: 11_607_087n,
  supply: 2_000n * 10n ** 18n,
  rows: [],
  disagreements: [],
});

const THEIRS: RamsStatus = { isFrozen: STATE.agentFrozen, nonce: STATE.principalNonce };

const RECORD: Attempt = {
  at: '2026-09-01T12:00:00.000Z',
  id: 'an-attempt',
  said: 'the stranger wrote this',
  answer: 'I am declining, because the document names its own settlement address.',
  reasoning: 'weighing it',
  intent: {
    action: 'decline',
    amount: '0',
    pricePerToken: '47',
    recipient: null,
    rationale: 'the document names its own settlement address',
  },
  verdict: 'declined',
  refusals: [],
  layers: {
    answers: [],
    blockNumber: STATE.blockNumber,
    onlyOurCode: false,
    note: null,
    dryRun: null,
  },
};

let asked = 0;
let directory = '';
let attempts = '';
let pages = '';

const sources = (over: Partial<DemoSources> = {}): DemoSources => ({
  reads,
  capTable: () => Promise.resolve(capTable()),
  ramsStatus: () => {
    asked += 1;
    return Promise.resolve(THEIRS);
  },
  attempt: () => Promise.resolve(RECORD),
  limits: createLimits({ spentOn: () => 0, switchedOff: () => false }),
  files: { attempts },
  publicDirectory: pages,
  ...over,
});

interface Answer {
  status: number;
  body: string;
}

const opened = async (
  run: (ask: (path: string, init?: RequestInit) => Promise<Answer>) => Promise<void>,
  over: Partial<DemoSources> = {},
): Promise<void> => {
  const server = demoServer(sources(over));
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const { port } = server.address() as AddressInfo;
  try {
    await run(async (path, init) => {
      const answer = await fetch(`http://127.0.0.1:${String(port)}${path}`, init);
      return { status: answer.status, body: await answer.text() };
    });
  } finally {
    await new Promise((closed) => server.close(closed));
  }
};

const lines = (body: string): Record<string, unknown>[] =>
  body
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

const posted = (document: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ say: document }),
});

beforeEach(() => {
  asked = 0;
  directory = mkdtempSync(join(tmpdir(), 'keeper-server-'));
  attempts = join(directory, 'demo-attempts.jsonl');
  pages = join(directory, 'public');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('every route the page needs answers', () => {
  it('serves the state, the evidence, the attempts, and one attempt by name', async () => {
    appendRecord(attempts, RECORD);

    await opened(async (ask) => {
      const state = await ask('/api/state');
      const evidence = await ask('/api/evidence');
      const listing = await ask('/api/attempts');
      const one = await ask(`/api/attempts/${RECORD.id}`);

      expect(state.status).toBe(200);
      expect(JSON.parse(state.body)).toEqual(
        expect.objectContaining({ attackBoxOn: true, blockNumber: STATE.blockNumber }),
      );
      expect(JSON.parse(evidence.body)).toEqual(
        expect.objectContaining({ evidence: expect.any(Array) as unknown[] }),
      );
      expect(JSON.parse(listing.body)).toHaveLength(1);
      expect(one.body).toBe(RECORD.said);
    });
  });

  it('keeps the words a stranger wrote out of the listing and behind their own name', async () => {
    appendRecord(attempts, RECORD);

    await opened(async (ask) => {
      const listing = await ask('/api/attempts');

      expect(listing.body).not.toContain(RECORD.said);
    });
  });

  it('answers a plain statement for an attempt nobody made', async () => {
    await opened(async (ask) => {
      const missing = await ask('/api/attempts/never-happened');

      expect(missing.status).toBe(404);
      expect(JSON.parse(missing.body)).toEqual({ says: expect.any(String) as string });
    });
  });

  it('answers a plain statement at an address that is not a route', async () => {
    await opened(async (ask) => {
      expect((await ask('/nothing-here')).status).toBe(404);
      expect((await ask('/api/state', { method: 'DELETE' })).status).toBe(404);
    });
  });

  it('serves the page when it is built and says so plainly when it is not', async () => {
    await opened(async (ask) => {
      expect((await ask('/')).status).toBe(404);
    });

    mkdirSync(pages);
    writeFileSync(join(pages, 'index.html'), '<p>the page</p>', 'utf8');
    await opened(async (ask) => {
      const page = await ask('/');

      expect(page.status).toBe(200);
      expect(page.body).toContain('the page');
    });
  });
});

describe('what Brickken are asked, and how often', () => {
  it('reads as soon as it is listening, so the first visitor is not the one who waits', async () => {
    await opened(async () => {
      await vi.waitFor(() => {
        expect(asked).toBe(1);
      });
    });
  });

  it('asks their status endpoint once however many visitors are looking', async () => {
    await opened(async (ask) => {
      await Promise.all([ask('/api/state'), ask('/api/state'), ask('/api/state')]);

      expect(asked).toBe(1);
    });
  });

  it('reports their answer beside the chain and says the two agree', async () => {
    await opened(async (ask) => {
      const { agreement } = JSON.parse((await ask('/api/state')).body) as {
        agreement: { reachable: boolean; says: string; rows: { agree: boolean }[] };
      };

      expect(agreement.reachable).toBe(true);
      expect(agreement.rows.every((row) => row.agree)).toBe(true);
      expect(agreement.says).toContain('the same');
    });
  });

  it('says which one disagrees rather than choosing between them', async () => {
    await opened(
      async (ask) => {
        const { agreement } = JSON.parse((await ask('/api/state')).body) as {
          agreement: { says: string };
        };

        expect(agreement.says).toContain('other than');
      },
      { ramsStatus: () => Promise.resolve({ ...THEIRS, nonce: '99' }) },
    );
  });

  it('still serves the page when their endpoint cannot be read, and says it could not', async () => {
    await opened(
      async (ask) => {
        const state = await ask('/api/state');
        const { agreement } = JSON.parse(state.body) as {
          agreement: { reachable: boolean; readAt: string | null; says: string };
        };

        expect(state.status).toBe(200);
        expect(agreement.reachable).toBe(false);
        expect(agreement.readAt).toBeNull();
        expect(agreement.says).toContain('could not be read');
      },
      { ramsStatus: () => Promise.reject(new KeeperError('brickkenUnreachable', 'no route')) },
    );
  });
});

describe('the page fails closed and never shows a value it did not get', () => {
  it('says the chain could not be read rather than serving a stale state', async () => {
    await opened(
      async (ask) => {
        const state = await ask('/api/state');

        expect(state.status).toBe(502);
        expect(JSON.parse(state.body)).toEqual({ says: ERROR_COPY.brickkenUnreachable });
      },
      {
        reads: {
          ...reads,
          state: () => Promise.reject(new KeeperError('brickkenUnreachable', 'x')),
        },
      },
    );
  });

  it('shows a busy model as a wait with a time, and never as a failure', async () => {
    const busy: typeof runTurn = () =>
      Promise.reject(new KeeperError('modelBusy', 'HTTP 429 from the vendor'));

    await opened(
      async (ask) => {
        const answer = await ask('/api/attempt', posted('a bid'));

        expect(answer.status).toBe(503);
        expect(JSON.parse(answer.body)).toEqual({
          says: ERROR_COPY.modelBusy,
          retryAfterSeconds: WAIT_SECONDS,
        });
      },
      { attempt: busy },
    );
  });

  it('says nothing about what went wrong when it does not know', async () => {
    const broken: typeof runTurn = () => Promise.reject(new TypeError('undefined is not a fish'));

    await opened(
      async (ask) => {
        const answer = await ask('/api/attempt', posted('a bid'));

        expect(answer.status).toBe(500);
        expect(answer.body).not.toContain('fish');
      },
      { attempt: broken },
    );
  });
});

describe('the server holds the conversation, so the page cannot invent one', () => {
  it('gives the agent every turn so far, in the order they were said', async () => {
    const seen: string[][] = [];
    const remembers: typeof runTurn = (turns) => {
      seen.push(turns.map((turn) => `${turn.who}:${turn.text}`));
      return Promise.resolve(RECORD);
    };

    await opened(
      async (ask) => {
        await ask('/api/attempt', posted('first'));
        await ask('/api/attempt', posted('second'));
      },
      { attempt: remembers },
    );

    expect(seen[0]).toEqual(['visitor:first']);
    expect(seen[1]).toEqual(['visitor:first', `agent:${RECORD.answer}`, 'visitor:second']);
  });

  it('refuses a turn past the length a conversation may run, and names that limit', async () => {
    await opened(
      async (ask) => {
        await ask('/api/attempt', posted('one'));
        const over = await ask('/api/attempt', posted('two'));

        expect(over.status).toBe(429);
        expect(JSON.parse(over.body)).toEqual(
          expect.objectContaining({ limit: 'thread', says: expect.any(String) as string }),
        );
      },
      { threads: createThreads({ turns: 2 }) },
    );
  });
});

describe('what the attack box accepts', () => {
  it('runs the attempt and answers with the outcome, never with the words that caused it', async () => {
    await opened(async (ask) => {
      const answer = await ask('/api/attempt', posted('Harbour Lane will buy 200 SUNL at 47 BKN.'));

      expect(answer.status).toBe(200);
      expect(answer.body).not.toContain(RECORD.said);
      expect(lines(answer.body).at(-1)).toEqual({
        attempt: expect.objectContaining({ id: RECORD.id, verdict: 'declined' }) as unknown,
      });
    });
  });

  it('reports each step as it lands, so the wait shows what really happened', async () => {
    const walked: typeof runTurn = (_turns, run) => {
      run.onStage?.({ stage: 'reading', ms: 12 });
      run.onStage?.({ stage: 'model', ms: 3400 });
      return Promise.resolve(RECORD);
    };

    await opened(
      async (ask) => {
        const answer = await ask('/api/attempt', posted('a bid'));
        const sent = lines(answer.body);

        expect(sent.slice(0, 2)).toEqual([
          { stage: 'reading', ms: 12 },
          { stage: 'model', ms: 3400 },
        ]);
        expect(sent.at(-1)).toHaveProperty('attempt');
      },
      { attempt: walked },
    );
  });

  it('ends a stream it cannot finish with a readable failure rather than a dead line', async () => {
    const diesLate: typeof runTurn = (_turns, run) => {
      run.onStage?.({ stage: 'reading', ms: 9 });
      return Promise.reject(new KeeperError('modelBusy', 'HTTP 429 from the vendor'));
    };

    await opened(
      async (ask) => {
        const answer = await ask('/api/attempt', posted('a bid'));

        expect(answer.status).toBe(200);
        expect(lines(answer.body).at(-1)).toEqual({
          error: { says: ERROR_COPY.modelBusy, retryAfterSeconds: WAIT_SECONDS },
        });
      },
      { attempt: diesLate },
    );
  });

  it('refuses a body that is not JSON, and one that carries no document', async () => {
    await opened(async (ask) => {
      const notJson = await ask('/api/attempt', { method: 'POST', body: 'not json' });
      const empty = await ask('/api/attempt', posted('   '));

      expect(notJson.status).toBe(400);
      expect(JSON.parse(empty.body)).toEqual({ says: ERROR_COPY.requestUnusable });
    });
  });

  it('stops reading a body longer than it accepts', async () => {
    await opened(async (ask) => {
      const huge = await ask('/api/attempt', posted('x'.repeat(MAX_BODY_BYTES + 1)));

      expect(huge.status).toBe(413);
    });
  });

  it('passes on the limit refusal as a wait, with the reason it was refused', async () => {
    await opened(
      async (ask) => {
        const answer = await ask('/api/attempt', posted('a bid'));

        expect(answer.status).toBe(429);
        expect(JSON.parse(answer.body)).toEqual(
          expect.objectContaining({ limit: 'off', says: expect.any(String) as string }),
        );
      },
      { limits: createLimits({ spentOn: () => 0, switchedOff: () => true }) },
    );
  });
});

const envValues = (): string[] =>
  existsSync(ENV_FILE)
    ? readFileSync(ENV_FILE, 'utf8')
        .split(/\r?\n/)
        .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
        .map((line) => line.slice(line.indexOf('=') + 1).trim())
        .filter((value) => value.length >= 16)
    : [];

describe('nothing this project holds reaches a visitor', () => {
  it('serves no value from the env file on any route it answers', async () => {
    const secrets = envValues();
    if (existsSync(ENV_FILE)) expect(secrets.length).toBeGreaterThan(0);
    appendRecord(attempts, RECORD);

    await opened(async (ask) => {
      const bodies = [
        (await ask('/api/state')).body,
        (await ask('/api/evidence')).body,
        (await ask('/api/attempts')).body,
        (await ask(`/api/attempts/${RECORD.id}`)).body,
        (await ask('/api/attempt', posted('a bid'))).body,
        (await ask('/nothing-here')).body,
      ].join('\n');

      expect(secrets.filter((secret) => bodies.includes(secret))).toEqual([]);
    });
  });
});

describe('what Brickken send back is read rather than assumed', () => {
  it('takes the frozen flag and the replay number they publish', () => {
    expect(asRamsStatus({ isFrozen: false, nonce: '6', extra: 'ignored' })).toEqual({
      isFrozen: false,
      nonce: '6',
    });
  });

  it('refuses a body that answers neither question', async () => {
    expect((await captureError(() => Promise.resolve(asRamsStatus({ nonce: '6' })))).kind).toBe(
      'brickkenUnreadable',
    );
    expect(
      (await captureError(() => Promise.resolve(asRamsStatus({ isFrozen: false })))).kind,
    ).toBe('brickkenUnreadable');
  });
});
