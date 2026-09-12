import type { DeliverIntent } from '../keeper/intent.js';

export const PROPOSAL_LAPSE_SECONDS = 30 * 60;

export interface Proposals {
  keep: (session: string, intent: DeliverIntent) => void;
  held: (session: string) => DeliverIntent | null;
  refuse: (session: string, why: string) => void;
  refusal: (session: string) => string | null;
  drop: (session: string) => void;
}

export interface ProposalRun {
  now?: () => number;
  lapseSeconds?: number;
}

interface OnScreen {
  intent: DeliverIntent | null;
  why: string | null;
  at: number;
}

/** Per visitor and in memory, so a restart never sends what an earlier process proposed. */
export function createProposals({
  now = Date.now,
  lapseSeconds = PROPOSAL_LAPSE_SECONDS,
}: ProposalRun = {}): Proposals {
  const kept = new Map<string, OnScreen>();

  const forget = (nowMs: number): void => {
    const since = nowMs - lapseSeconds * 1000;
    for (const [session, held] of kept) if (held.at <= since) kept.delete(session);
  };

  const put = (session: string, screen: Omit<OnScreen, 'at'>): void => {
    forget(now());
    kept.set(session, { ...screen, at: now() });
  };

  const read = (session: string): OnScreen | undefined => {
    forget(now());
    return kept.get(session);
  };

  return {
    keep: (session, intent) => {
      put(session, { intent, why: null });
    },
    held: (session) => read(session)?.intent ?? null,
    refuse: (session, why) => {
      put(session, { intent: null, why });
    },
    refusal: (session) => read(session)?.why ?? null,
    drop: (session) => {
      kept.delete(session);
    },
  };
}
