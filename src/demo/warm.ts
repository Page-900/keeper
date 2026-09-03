export const STATE_CACHE_SECONDS = 60;

export const STATE_REFRESH_SECONDS = 45;

export const STATE_COOL_SECONDS = 20;

export interface Warm<T> {
  read: () => Promise<T>;
  start: () => void;
  stop: () => void;
}

export interface WarmRun {
  seconds?: number;
  every?: number;
  cool?: number;
  now?: () => number;
}

interface Held<T> {
  at: number;
  value: Promise<T>;
  failed: boolean;
}

/** The promise is held, not just the answer, so two visitors at once are still one call out. */
export function warmed<T>(make: () => Promise<T>, run: WarmRun = {}): Warm<T> {
  const {
    seconds = STATE_CACHE_SECONDS,
    every = STATE_REFRESH_SECONDS,
    cool = STATE_COOL_SECONDS,
    now = Date.now,
  } = run;
  let held: Held<T> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let wanted = false;

  /** A refusal is held briefly too, so a source that is already saying stop is not stampeded. */
  const refresh = (): Promise<T> => {
    const value = make();
    held = { at: now(), value, failed: false };
    return value.catch((cause: unknown) => {
      if (held?.value === value) held = { at: now(), value, failed: true };
      throw cause;
    });
  };

  const fresh = (): boolean =>
    held !== null && now() - held.at < (held.failed ? cool : seconds) * 1000;

  const whileWatched = (): void => {
    if (!wanted) return;
    wanted = false;
    refresh().catch(() => undefined);
  };

  return {
    read: () => {
      wanted = true;
      return fresh() && held !== null ? held.value : refresh();
    },
    start: () => {
      if (timer === null) timer = setInterval(whileWatched, every * 1000).unref();
      refresh().catch(() => undefined);
    },
    stop: () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
