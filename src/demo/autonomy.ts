export const AUTONOMY_LAPSE_SECONDS = 30 * 60;

export const EXECUTE_ON =
  'Keeper may put its own approved sale on the chain from here. It still has to get past the ' +
  'guard, the router, the mandate and the token, and one visitor sends one at a time.';

export const EXECUTE_OFF =
  'Keeper may propose and may not send. Nothing it is told, and nothing it decides, changes that.';

export interface Autonomy {
  on: (session: string) => boolean;
  set: (session: string, wanted: boolean) => void;
}

export interface AutonomyRun {
  now?: () => number;
  lapseSeconds?: number;
}

/** Held per process and per visitor, so a restart hands everyone back the safe answer. */
export function createAutonomy({
  now = Date.now,
  lapseSeconds = AUTONOMY_LAPSE_SECONDS,
}: AutonomyRun = {}): Autonomy {
  const turnedOn = new Map<string, number>();

  const forget = (nowMs: number): void => {
    const since = nowMs - lapseSeconds * 1000;
    for (const [session, at] of turnedOn) if (at <= since) turnedOn.delete(session);
  };

  return {
    on: (session) => {
      forget(now());
      return turnedOn.has(session);
    },
    set: (session, wanted) => {
      const nowMs = now();
      forget(nowMs);
      if (wanted) turnedOn.set(session, nowMs);
      else turnedOn.delete(session);
    },
  };
}
