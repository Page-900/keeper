import { describe, expect, it } from 'vitest';

import {
  AUTONOMY_LAPSE_SECONDS,
  EXECUTE_OFF,
  EXECUTE_ON,
  createAutonomy,
  type Autonomy,
} from '../src/demo/autonomy.js';

const NOON = Date.parse('2026-09-01T12:00:00.000Z');
const ONE = 'a-visitor';
const OTHER = 'someone-else';

let clock = NOON;

const store = (): Autonomy => createAutonomy({ now: () => clock });

describe('what the switch says it does is what it does', () => {
  it('promises no daily allowance, because the page stopped having one', () => {
    expect(EXECUTE_ON).not.toMatch(/a day|daily|ever/i);
    expect(EXECUTE_OFF).not.toMatch(/a day|daily|ever/i);
  });

  it('names every layer that still stands between the agent and the chain', () => {
    for (const layer of ['guard', 'router', 'mandate', 'token'])
      expect(EXECUTE_ON).toContain(layer);
  });
});

describe('the execute switch', () => {
  it('is off until a visitor turns it on', () => {
    clock = NOON;
    expect(store().on(ONE)).toBe(false);
  });

  it('is on for the visitor who turned it on', () => {
    clock = NOON;
    const switches = store();
    switches.set(ONE, true);
    expect(switches.on(ONE)).toBe(true);
  });

  it('goes off again when the same visitor turns it off', () => {
    clock = NOON;
    const switches = store();
    switches.set(ONE, true);
    switches.set(ONE, false);
    expect(switches.on(ONE)).toBe(false);
  });

  it('never reaches another visitor', () => {
    clock = NOON;
    const switches = store();
    switches.set(ONE, true);
    expect(switches.on(OTHER)).toBe(false);
  });

  it('lapses once the window has passed', () => {
    clock = NOON;
    const switches = store();
    switches.set(ONE, true);
    clock = NOON + AUTONOMY_LAPSE_SECONDS * 1000;
    expect(switches.on(ONE)).toBe(false);
  });

  it('holds until the window has passed', () => {
    clock = NOON;
    const switches = store();
    switches.set(ONE, true);
    clock = NOON + AUTONOMY_LAPSE_SECONDS * 1000 - 1;
    expect(switches.on(ONE)).toBe(true);
  });

  it('knows nothing after a restart', () => {
    clock = NOON;
    const before = store();
    before.set(ONE, true);
    expect(store().on(ONE)).toBe(false);
  });

  it('starts the window again each time it is turned on', () => {
    clock = NOON;
    const switches = store();
    switches.set(ONE, true);
    clock = NOON + AUTONOMY_LAPSE_SECONDS * 500;
    switches.set(ONE, true);
    clock = NOON + AUTONOMY_LAPSE_SECONDS * 1000;
    expect(switches.on(ONE)).toBe(true);
  });
});
