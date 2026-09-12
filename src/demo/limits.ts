import { ATTEMPT_FILE, listAttempts } from './log.js';

export const MAX_DOCUMENT_CHARACTERS = 8_000;

export const ATTEMPTS_PER_SESSION = 10;

export const SESSION_WINDOW_SECONDS = 10 * 60;

export const ATTEMPTS_PER_DAY = 400;

export const READS_PER_SESSION = 20;

/** The mean of the recorded calls. A heavy visitor costs more and is refused by the vendor. */
export const TOKENS_PER_ATTEMPT = 6_940;

/** Not a secret and never read through the env file, so its value is never made redactable. */
export const OFF_SWITCH = 'DEMO_ATTEMPTS_OFF';

export const attackBoxOff = (): boolean => process.env[OFF_SWITCH] !== undefined;

export type LimitName = 'off' | 'length' | 'session' | 'daily' | 'thread';

export interface Blocked {
  allowed: false;
  limit: LimitName;
  because: string;
  retryAfterSeconds: number | null;
}

export type LimitAnswer = { allowed: true } | Blocked;

const ALLOWED: LimitAnswer = Object.freeze({ allowed: true });

const blocked = (limit: LimitName, because: string, retryAfterSeconds: number | null): Blocked => ({
  allowed: false,
  limit,
  because,
  retryAfterSeconds,
});

const DAY_SECONDS = 24 * 60 * 60;

export const utcDay = (nowMs: number): string => new Date(nowMs).toISOString().slice(0, 10);

const untilMidnight = (nowMs: number): number =>
  DAY_SECONDS - Math.floor((nowMs / 1000) % DAY_SECONDS);

export const attemptsRecordedOn = (day: string, file: string = ATTEMPT_FILE): number =>
  listAttempts(file).filter((attempt) => attempt.at.startsWith(day)).length;

export interface Window {
  take: (session: string, nowMs: number) => number | null;
}

/** Counts what one visitor did inside a moving window, and forgets a visitor who stopped. */
export function slidingWindow(most: number, seconds: number): Window {
  const seen = new Map<string, number[]>();
  return {
    take: (session, nowMs) => {
      const since = nowMs - seconds * 1000;
      for (const [key, times] of seen) {
        const live = times.filter((at) => at > since);
        if (live.length === 0) seen.delete(key);
        else seen.set(key, live);
      }
      const times = seen.get(session) ?? [];
      if (times.length >= most) {
        const oldest = times[0] ?? nowMs;
        return Math.ceil((oldest + seconds * 1000 - nowMs) / 1000);
      }
      seen.set(session, [...times, nowMs]);
      return null;
    },
  };
}

export interface LimitsRun {
  now?: () => number;
  spentOn?: (day: string) => number;
  switchedOff?: () => boolean;
}

export interface Limits {
  take: (session: string, document: string) => LimitAnswer;
}

interface Day {
  day: string;
  used: number;
}

/** Seeded from the record, because a restart would otherwise hand the ceiling back unspent. */
export function createLimits({
  now = Date.now,
  spentOn = attemptsRecordedOn,
  switchedOff = attackBoxOff,
}: LimitsRun = {}): Limits {
  const sessions = slidingWindow(ATTEMPTS_PER_SESSION, SESSION_WINDOW_SECONDS);
  let today: Day = { day: '', used: 0 };

  const dayOf = (nowMs: number): Day => {
    const day = utcDay(nowMs);
    if (today.day !== day) today = { day, used: spentOn(day) };
    return today;
  };

  return {
    take: (session, document) => {
      if (switchedOff())
        return blocked(
          'off',
          'The attack box is switched off right now. Everything else on this page still works.',
          null,
        );

      if (document.length > MAX_DOCUMENT_CHARACTERS)
        return blocked(
          'length',
          `That document is ${String(document.length)} characters, and the box takes ${String(MAX_DOCUMENT_CHARACTERS)} at most.`,
          null,
        );

      const nowMs = now();
      const day = dayOf(nowMs);
      if (day.used >= ATTEMPTS_PER_DAY)
        return blocked(
          'daily',
          'This page has run the model as many times as it may today. It opens again at midnight UTC.',
          untilMidnight(nowMs),
        );

      const wait = sessions.take(session, nowMs);
      if (wait !== null)
        return blocked(
          'session',
          `That is ${String(ATTEMPTS_PER_SESSION)} attempts from you inside ${String(SESSION_WINDOW_SECONDS / 60)} minutes, which is as many as one visitor may run.`,
          wait,
        );

      day.used += 1;
      return ALLOWED;
    },
  };
}
