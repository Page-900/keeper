export const MAX_TURNS = 12;

export const MAX_THREAD_CHARACTERS = 24_000;

export const MAX_THREADS = 500;

export const THREAD_IDLE_SECONDS = 30 * 60;

export interface Turn {
  who: 'visitor' | 'agent';
  text: string;
  at: string;
}

export type Told = { allowed: true } | { allowed: false; because: string };

export interface Threads {
  turns: (session: string) => readonly Turn[];
  heard: (session: string, text: string) => Told;
  answered: (session: string, text: string) => void;
  forget: (session: string) => void;
  open: () => number;
}

export interface ThreadRun {
  now?: () => number;
  idle?: number;
  most?: number;
  turns?: number;
  characters?: number;
}

interface Held {
  at: number;
  turns: Turn[];
  size: number;
}

const refused = (because: string): Told => ({ allowed: false, because });

const ALLOWED: Told = Object.freeze({ allowed: true });

/** A caller can only ever add a visitor turn, so no page can show words the agent never said. */
export function createThreads(run: ThreadRun = {}): Threads {
  const {
    now = Date.now,
    idle = THREAD_IDLE_SECONDS,
    most = MAX_THREADS,
    turns: mostTurns = MAX_TURNS,
    characters = MAX_THREAD_CHARACTERS,
  } = run;
  const held = new Map<string, Held>();

  const dropStale = (at: number): void => {
    for (const [session, thread] of held) if (at - thread.at > idle * 1000) held.delete(session);
  };

  const makeRoom = (): void => {
    while (held.size >= most) {
      const oldest = held.keys().next();
      if (oldest.done === true) return;
      held.delete(oldest.value);
    }
  };

  const threadFor = (session: string, at: number): Held => {
    const found = held.get(session);
    if (found !== undefined) return found;
    makeRoom();
    const fresh: Held = { at, turns: [], size: 0 };
    held.set(session, fresh);
    return fresh;
  };

  const add = (session: string, who: Turn['who'], text: string): void => {
    const at = now();
    const thread = threadFor(session, at);
    thread.turns.push({ who, text, at: new Date(at).toISOString() });
    thread.size += text.length;
    thread.at = at;
  };

  return {
    turns: (session) => held.get(session)?.turns ?? [],
    heard: (session, text) => {
      const at = now();
      dropStale(at);
      const thread = threadFor(session, at);
      if (thread.turns.length >= mostTurns)
        return refused(
          `This conversation has run its ${String(mostTurns)} turns. Reload the page to start another.`,
        );
      if (thread.size + text.length > characters)
        return refused(
          'This conversation is as long as the page will carry. Reload to start another.',
        );
      add(session, 'visitor', text);
      return ALLOWED;
    },
    answered: (session, text) => {
      add(session, 'agent', text);
    },
    forget: (session) => {
      held.delete(session);
    },
    open: () => held.size,
  };
}
