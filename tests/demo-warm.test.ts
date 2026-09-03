import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  STATE_CACHE_SECONDS,
  STATE_COOL_SECONDS,
  STATE_REFRESH_SECONDS,
  warmed,
} from '../src/demo/warm.js';

const counted = (): { make: () => Promise<number>; calls: () => number } => {
  let calls = 0;
  return {
    make: () => {
      calls += 1;
      return Promise.resolve(calls);
    },
    calls: () => calls,
  };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the page holds an answer instead of making a visitor wait for one', () => {
  it('reads nothing at all until it is started or asked', () => {
    const source = counted();

    warmed(source.make);

    expect(source.calls()).toBe(0);
  });

  it('reads once when it starts, so the first visitor is handed what is already in hand', async () => {
    const source = counted();
    const warm = warmed(source.make);

    warm.start();
    warm.stop();

    expect(source.calls()).toBe(1);
    await expect(warm.read()).resolves.toBe(1);
    expect(source.calls()).toBe(1);
  });

  it('reads again inside the window it publishes, so what it holds is never stale', async () => {
    const source = counted();
    const warm = warmed(source.make);

    warm.start();
    await warm.read();
    await vi.advanceTimersByTimeAsync(STATE_REFRESH_SECONDS * 1000);
    warm.stop();

    expect(STATE_REFRESH_SECONDS).toBeLessThan(STATE_CACHE_SECONDS);
    expect(source.calls()).toBe(2);
  });

  it('calls nobody at all while no visitor is asking, so an idle page is free', async () => {
    const source = counted();
    const warm = warmed(source.make);

    warm.start();
    await vi.advanceTimersByTimeAsync(STATE_REFRESH_SECONDS * 8000);
    warm.stop();

    expect(source.calls()).toBe(1);
  });

  it('goes quiet again once the visitor stops asking', async () => {
    const source = counted();
    const warm = warmed(source.make);

    warm.start();
    await warm.read();
    await vi.advanceTimersByTimeAsync(STATE_REFRESH_SECONDS * 5000);
    warm.stop();

    expect(source.calls()).toBe(2);
  });

  it('stops reading once it is stopped, so a closed page asks Brickken nothing', async () => {
    const source = counted();
    const warm = warmed(source.make);

    warm.start();
    warm.stop();
    await vi.advanceTimersByTimeAsync(STATE_REFRESH_SECONDS * 4000);

    expect(source.calls()).toBe(1);
  });

  it('makes one call for however many visitors arrive at once', async () => {
    const source = counted();
    const warm = warmed(source.make);

    await Promise.all([warm.read(), warm.read(), warm.read()]);

    expect(source.calls()).toBe(1);
  });

  it('reads afresh for a visitor who arrives after the window, if nothing refreshed it', async () => {
    const source = counted();
    let clock = 0;
    const warm = warmed(source.make, { now: () => clock });

    await warm.read();
    clock = STATE_CACHE_SECONDS * 1000;

    await expect(warm.read()).resolves.toBe(2);
  });

  it('drops a read that failed rather than holding it, so the next visitor gets a live one', async () => {
    let broken = true;
    let clock = 0;
    const warm = warmed(
      () => (broken ? Promise.reject(new Error('no chain')) : Promise.resolve('read')),
      { now: () => clock },
    );

    await expect(warm.read()).rejects.toThrow('no chain');
    broken = false;
    clock = STATE_COOL_SECONDS * 1000;

    await expect(warm.read()).resolves.toBe('read');
  });

  it('holds a refusal briefly, so a source already saying stop is not asked by everyone at once', async () => {
    let calls = 0;
    const warm = warmed(() => {
      calls += 1;
      return Promise.reject(new Error('rate limit'));
    });

    await expect(warm.read()).rejects.toThrow('rate limit');
    await expect(warm.read()).rejects.toThrow('rate limit');
    await expect(warm.read()).rejects.toThrow('rate limit');

    expect(STATE_COOL_SECONDS).toBeLessThan(STATE_CACHE_SECONDS);
    expect(calls).toBe(1);
  });
});
