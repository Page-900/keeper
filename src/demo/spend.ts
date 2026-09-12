import { ANCHOR_FILE, type Anchor, type AnchorAction } from '../chain/anchors.js';
import { readRecords } from '../shared/jsonl.js';

export const SECONDS_BETWEEN_SENDS = 60;

const ACTION = 'page-action-';

export const pageSends = (file: string = ANCHOR_FILE): Anchor[] =>
  readRecords<Anchor>(file).filter(
    (anchor) => anchor.action.startsWith(ACTION) && anchor.status === 'success',
  );

export const nextAction = (file: string = ANCHOR_FILE): AnchorAction =>
  `${ACTION}${String(pageSends(file).length + 1)}` as AnchorAction;

export const nextReturn = (file: string = ANCHOR_FILE): AnchorAction =>
  `page-return-${String(pageSends(file).length + 1)}` as AnchorAction;

export interface Ready {
  allowed: boolean;
  because: string;
  waitSeconds: number;
}

export interface SendClock {
  ready: (session: string) => Ready;
  sent: (session: string) => void;
}

export interface ClockRun {
  now?: () => number;
  seconds?: number;
}

const READY = 'This page may send now, and what it sends is real.';

const waiting = (seconds: number): string =>
  `That was a send a moment ago. One visitor sends one at a time here, so that the gas this ` +
  `page runs on is still there for the next person. It is ready again in ${String(seconds)} seconds.`;

/** Per visitor and never a total, because a test nobody can run twice proves nothing. */
export function createSendClock({
  now = Date.now,
  seconds = SECONDS_BETWEEN_SENDS,
}: ClockRun = {}) {
  const last = new Map<string, number>();

  const forget = (nowMs: number): void => {
    const since = nowMs - seconds * 1000;
    for (const [session, at] of last) if (at <= since) last.delete(session);
  };

  return {
    ready: (session: string): Ready => {
      const nowMs = now();
      forget(nowMs);
      const at = last.get(session);
      if (at === undefined) return { allowed: true, because: READY, waitSeconds: 0 };
      const waitSeconds = Math.ceil((at + seconds * 1000 - nowMs) / 1000);
      return { allowed: false, because: waiting(waitSeconds), waitSeconds };
    },
    sent: (session: string): void => {
      const nowMs = now();
      forget(nowMs);
      last.set(session, nowMs);
    },
  };
}
