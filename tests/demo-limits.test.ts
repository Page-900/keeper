import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ATTEMPTS_PER_DAY,
  attemptsRecordedOn,
  ATTEMPTS_PER_SESSION,
  MAX_DOCUMENT_CHARACTERS,
  OFF_SWITCH,
  SESSION_WINDOW_SECONDS,
  createLimits,
  type LimitAnswer,
  type Limits,
  type LimitsRun,
} from '../src/demo/limits.js';
import { appendRecord } from '../src/shared/jsonl.js';

const NOON = Date.parse('2026-09-01T12:00:00.000Z');
const DOCUMENT = 'Harbour Lane Partners will buy 200 SUNL at 47 BKN.';
const SESSION = 'a-visitor';

let clock = NOON;

const limits = (over: LimitsRun = {}): Limits =>
  createLimits({
    now: () => clock,
    spentOn: () => 0,
    switchedOff: () => false,
    ...over,
  });

const runs = (limit: Limits, count: number, session = SESSION): LimitAnswer => {
  let answer: LimitAnswer = { allowed: true };
  for (let at = 0; at < count; at += 1) answer = limit.take(session, DOCUMENT);
  return answer;
};

const refusal = (answer: LimitAnswer): Exclude<LimitAnswer, { allowed: true }> => {
  if (answer.allowed) throw new Error('expected the attempt to be refused');
  return answer;
};

beforeEach(() => {
  clock = NOON;
});

describe('the operator can switch the attack box off from the environment', () => {
  afterEach(() => {
    Reflect.deleteProperty(process.env, OFF_SWITCH);
  });

  it('refuses every attempt while the switch is set, whatever the value is', () => {
    process.env[OFF_SWITCH] = '1';

    const answer = refusal(
      createLimits({ now: () => clock, spentOn: () => 0 }).take(SESSION, DOCUMENT),
    );

    expect(answer.limit).toBe('off');
    expect(answer.because).toContain('switched off');
  });

  it('reads an empty value as off too, because the safe way to be wrong is closed', () => {
    process.env[OFF_SWITCH] = '';

    expect(
      refusal(createLimits({ now: () => clock, spentOn: () => 0 }).take(SESSION, DOCUMENT)).limit,
    ).toBe('off');
  });

  it('allows attempts again once the switch is gone', () => {
    expect(createLimits({ now: () => clock, spentOn: () => 0 }).take(SESSION, DOCUMENT)).toEqual({
      allowed: true,
    });
  });
});

describe('a document longer than the box takes is refused before the model is asked', () => {
  it('refuses one character over the cap and says how long it was', () => {
    const answer = refusal(limits().take(SESSION, 'x'.repeat(MAX_DOCUMENT_CHARACTERS + 1)));

    expect(answer.limit).toBe('length');
    expect(answer.because).toContain(String(MAX_DOCUMENT_CHARACTERS + 1));
  });

  it('takes a document exactly as long as the cap', () => {
    expect(limits().take(SESSION, 'x'.repeat(MAX_DOCUMENT_CHARACTERS))).toEqual({ allowed: true });
  });

  it('spends nothing from the day when it refuses on length', () => {
    const limit = limits();

    limit.take(SESSION, 'x'.repeat(MAX_DOCUMENT_CHARACTERS + 1));

    expect(runs(limit, ATTEMPTS_PER_SESSION).allowed).toBe(true);
  });
});

describe('one visitor may not run the page all day', () => {
  it('refuses the attempt after the last one the window allows', () => {
    const limit = limits();

    expect(runs(limit, ATTEMPTS_PER_SESSION).allowed).toBe(true);
    const answer = refusal(limit.take(SESSION, DOCUMENT));

    expect(answer.limit).toBe('session');
    expect(answer.retryAfterSeconds).toBe(SESSION_WINDOW_SECONDS);
  });

  it('lets the same visitor back in once the window has passed', () => {
    const limit = limits();
    runs(limit, ATTEMPTS_PER_SESSION);

    clock += SESSION_WINDOW_SECONDS * 1000 + 1;

    expect(limit.take(SESSION, DOCUMENT)).toEqual({ allowed: true });
  });

  it('counts each visitor on their own', () => {
    const limit = limits();
    runs(limit, ATTEMPTS_PER_SESSION);

    expect(limit.take('someone-else', DOCUMENT)).toEqual({ allowed: true });
  });

  it('forgets a visitor whose window has passed, so the count cannot grow forever', () => {
    const limit = limits();
    runs(limit, 1, 'first');

    clock += SESSION_WINDOW_SECONDS * 1000 + 1;
    runs(limit, 1, 'second');
    clock -= SESSION_WINDOW_SECONDS * 1000 + 1;

    expect(runs(limit, ATTEMPTS_PER_SESSION, 'first').allowed).toBe(true);
  });
});

describe('the page runs the model a bounded number of times a day', () => {
  it('refuses once the day is spent, and says when it opens again', () => {
    const limit = limits({ spentOn: () => ATTEMPTS_PER_DAY });

    const answer = refusal(limit.take(SESSION, DOCUMENT));

    expect(answer.limit).toBe('daily');
    expect(answer.retryAfterSeconds).toBe(12 * 60 * 60);
  });

  it('counts what the record already holds for today, so a restart hands nothing back', () => {
    const limit = limits({ spentOn: () => ATTEMPTS_PER_DAY - 1 });

    expect(limit.take(SESSION, DOCUMENT)).toEqual({ allowed: true });
    expect(refusal(limit.take('another-visitor', DOCUMENT)).limit).toBe('daily');
  });

  it('asks the record about the day it is now, and starts the new day fresh', () => {
    const asked: string[] = [];
    const limit = limits({
      spentOn: (day) => {
        asked.push(day);
        return day === '2026-09-01' ? ATTEMPTS_PER_DAY : 0;
      },
    });
    expect(refusal(limit.take(SESSION, DOCUMENT)).limit).toBe('daily');

    clock += 24 * 60 * 60 * 1000;

    expect(limit.take(SESSION, DOCUMENT)).toEqual({ allowed: true });
    expect(asked).toEqual(['2026-09-01', '2026-09-02']);
  });
});

const claim = (at: string): object => ({
  at,
  id: at,
  document: DOCUMENT,
  reasoning: 'weighing it',
  intent: { action: 'decline', amount: '0', pricePerToken: '47', recipient: null, rationale: 'no' },
  verdict: 'declined',
  refusals: [],
  layers: { answers: [], blockNumber: null, onlyOurCode: false, note: null },
});

let directory = '';
let file = '';

describe('the day is counted off the attempts the record already holds', () => {
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'keeper-limits-'));
    file = join(directory, 'demo-attempts.jsonl');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('counts the attempts made on the day it is asked about and no others', () => {
    appendRecord(file, claim('2026-09-01T09:00:00.000Z'));
    appendRecord(file, claim('2026-09-01T23:59:59.000Z'));
    appendRecord(file, claim('2026-08-31T23:59:59.000Z'));

    expect(attemptsRecordedOn('2026-09-01', file)).toBe(2);
    expect(attemptsRecordedOn('2026-08-31', file)).toBe(1);
    expect(attemptsRecordedOn('2026-09-02', file)).toBe(0);
  });

  it('starts a day at nothing when the record holds no attempts at all', () => {
    expect(attemptsRecordedOn('2026-09-01', file)).toBe(0);
  });
});
