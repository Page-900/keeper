import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CapTable } from '../captable.js';
import type { RegistryRead } from '../chain/registry.js';
import { ERROR_COPY, KeeperError, type ErrorKind } from '../shared/errors.js';
import type { Stage } from '../shared/progress.js';
import type { GuardReads } from '../keeper/guard.js';
import { runTurn, type AttemptFiles } from './attempt.js';
import type { MandateReads } from './layers.js';
import {
  ATTEMPTS_PER_DAY,
  READS_PER_SESSION,
  SESSION_WINDOW_SECONDS,
  attackBoxOff,
  attemptsRecordedOn,
  createLimits,
  slidingWindow,
  utcDay,
  type Limits,
} from './limits.js';
import { listBids } from './bids.js';
import { ATTEMPT_FILE, listAttempts, withoutWords, wordsOf } from './log.js';
import { askAboutRecipient, type Asked } from './recipient.js';
import { createProposals, type Proposals } from './proposals.js';
import { createSendClock, type SendClock } from './spend.js';
import { createThreads, type Threads } from './thread.js';
import { authorityTable, demoView, evidenceTable } from './view.js';
import { warmed } from './warm.js';
import {
  AUTONOMY_LAPSE_SECONDS,
  EXECUTE_OFF,
  EXECUTE_ON,
  createAutonomy,
  type Autonomy,
} from './autonomy.js';

export const PUBLIC_DIRECTORY = fileURLToPath(new URL('../../public/', import.meta.url));

export const MAX_BODY_BYTES = 64_000;

export const NDJSON = 'application/x-ndjson; charset=utf-8';

/** Ours, not theirs: the vendor's busy answer carries no wait that this project has ever seen. */
export const WAIT_SECONDS = 60;

const STATUS: Partial<Record<ErrorKind, number>> = Object.freeze({
  requestUnusable: 400,
  requestTooLarge: 413,
  fenceBroken: 400,
  modelBusy: 503,
  brickkenRateLimited: 503,
  modelUnreachable: 502,
  brickkenUnreachable: 502,
  brickkenRejected: 502,
  brickkenUnreadable: 502,
  intentMalformed: 502,
});

export interface RamsStatus {
  isFrozen: boolean;
  nonce: string;
}

export interface AgreementRow {
  what: string;
  chain: string;
  brickken: string | null;
  agree: boolean | null;
}

export interface Agreement {
  readAt: string | null;
  reachable: boolean;
  rows: AgreementRow[];
  says: string;
}

const AGREES = 'Brickken report the same as their own contract does.';

const DISAGREES = 'Brickken report something other than what their own contract says.';

const UNREACHABLE =
  'Their status endpoint could not be read just now, so these are the chain values alone.';

const said = (frozen: boolean): string => (frozen ? 'yes' : 'no');

function agreementOf(state: RegistryRead, theirs: RamsStatus | null, at: number): Agreement {
  const rows: AgreementRow[] = [
    {
      what: 'the agent is frozen',
      chain: said(state.agentFrozen),
      brickken: theirs === null ? null : said(theirs.isFrozen),
      agree: theirs === null ? null : theirs.isFrozen === state.agentFrozen,
    },
    {
      what: 'the replay number',
      chain: state.principalNonce,
      brickken: theirs?.nonce ?? null,
      agree: theirs === null ? null : theirs.nonce === state.principalNonce,
    },
  ];
  return {
    readAt: theirs === null ? null : new Date(at).toISOString(),
    reachable: theirs !== null,
    rows,
    says:
      theirs === null ? UNREACHABLE : rows.every((row) => row.agree === true) ? AGREES : DISAGREES,
  };
}

export interface DemoSources {
  reads: GuardReads;
  capTable: () => Promise<CapTable>;
  ramsStatus: () => Promise<RamsStatus>;
  mandate?: MandateReads;
  attempt?: typeof runTurn;
  recipient?: (said: unknown) => Promise<Asked>;
  threads?: Threads;
  limits?: Limits;
  autonomy?: Autonomy;
  clock?: SendClock;
  proposals?: Proposals;
  files?: AttemptFiles;
  publicDirectory?: string;
  now?: () => number;
}

const PAGE: Readonly<Record<string, { file: string; type: string }>> = Object.freeze({
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/ui.js': { file: 'ui.js', type: 'text/javascript; charset=utf-8' },
  '/chat.js': { file: 'chat.js', type: 'text/javascript; charset=utf-8' },
  '/live.js': { file: 'live.js', type: 'text/javascript; charset=utf-8' },
  '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
});

/** The page loads nothing off-origin, so the policy can refuse every source. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
});

const send = (response: ServerResponse, status: number, type: string, body: string): void => {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': type,
    'cache-control': 'no-store',
  });
  response.end(body);
};

const json = (response: ServerResponse, status: number, body: unknown): void => {
  send(response, status, 'application/json; charset=utf-8', JSON.stringify(body));
};

const stated = (response: ServerResponse, status: number, says: string, extra = {}): void => {
  json(response, status, { says, ...extra });
};

/** The head is written on the first line, so a failure before any work keeps its status. */
const streamed = (response: ServerResponse) => (body: unknown) => {
  if (!response.headersSent)
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': NDJSON,
      'cache-control': 'no-store',
    });
  response.write(`${JSON.stringify(body)}
`);
};

/** A visitor is counted by a hash of where the request came from, and the address is never kept. */
const sessionOf = (request: IncomingMessage): string => {
  const forwarded = request.headers['fly-client-ip'] ?? request.headers['x-forwarded-for'];
  const from = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return createHash('sha256')
    .update(from ?? request.socket.remoteAddress ?? 'unknown')
    .digest('hex')
    .slice(0, 16);
};

async function readBody(request: IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const part = chunk as Buffer;
    size += part.length;
    if (size > MAX_BODY_BYTES)
      throw new KeeperError('requestTooLarge', `${String(size)} bytes and counting`);
    parts.push(part);
  }
  return Buffer.concat(parts).toString('utf8');
}

const wantedIn = (body: string): boolean => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new KeeperError('requestUnusable', 'the body is not JSON');
  }
  const wanted = (parsed as { on?: unknown } | null)?.on;
  if (typeof wanted !== 'boolean')
    throw new KeeperError('requestUnusable', 'on is not true or false');
  return wanted;
};

const sayingIn = (body: string): string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new KeeperError('requestUnusable', 'the body is not JSON');
  }
  const said = (parsed as { say?: unknown } | null)?.say;
  if (typeof said !== 'string' || said.trim() === '')
    throw new KeeperError('requestUnusable', 'nothing was said');
  return said;
};

const pageIn = (directory: string, file: string): string | null => {
  try {
    return readFileSync(join(directory, file), 'utf8');
  } catch {
    return null;
  }
};

export function demoServer(sources: DemoSources): Server {
  const {
    reads,
    attempt = runTurn,
    recipient = askAboutRecipient,
    limits = createLimits(),
    threads = createThreads(),
    autonomy = createAutonomy(),
    clock = createSendClock(),
    proposals = createProposals(),
    publicDirectory = PUBLIC_DIRECTORY,
    now = Date.now,
  } = sources;
  const attempts = sources.files?.attempts ?? ATTEMPT_FILE;

  const state = warmed(
    async () => {
      const read = await reads.state();
      const capTable = await sources.capTable().catch(() => null);
      const theirs = await sources.ramsStatus().catch(() => null);
      return {
        ...demoView({ state: read, capTable }),
        agreement: agreementOf(read, theirs, now()),
        attackBoxOn: !attackBoxOff(),
        attemptsLeftToday: Math.max(
          0,
          ATTEMPTS_PER_DAY - attemptsRecordedOn(utcDay(now()), attempts),
        ),
      };
    },
    { now },
  );

  const looks = slidingWindow(READS_PER_SESSION, SESSION_WINDOW_SECONDS);

  const recipientFor = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const body = await readBody(request);
    let said: unknown;
    try {
      said = (JSON.parse(body) as { address?: unknown } | null)?.address;
    } catch {
      throw new KeeperError('requestUnusable', 'the body is not JSON');
    }
    const wait = looks.take(sessionOf(request), now());
    if (wait !== null) {
      stated(response, 429, 'That is as many addresses as one visitor may check just now.', {
        limit: 'session',
        retryAfterSeconds: wait,
      });
      return;
    }
    json(response, 200, await recipient(said));
  };

  const switchState = (session: string): object => {
    const on = autonomy.on(session);
    return { on, lapseSeconds: AUTONOMY_LAPSE_SECONDS, says: on ? EXECUTE_ON : EXECUTE_OFF };
  };

  const switchFor = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const session = sessionOf(request);
    autonomy.set(session, wantedIn(await readBody(request)));
    json(response, 200, switchState(session));
  };

  const attemptFor = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const said = sayingIn(await readBody(request));
    const session = sessionOf(request);
    const answer = limits.take(session, said);
    if (!answer.allowed) {
      stated(response, 429, answer.because, {
        limit: answer.limit,
        retryAfterSeconds: answer.retryAfterSeconds,
      });
      return;
    }
    const told = threads.heard(session, said);
    if (!told.allowed) {
      stated(response, 429, told.because, { limit: 'thread', retryAfterSeconds: null });
      return;
    }
    const emit = streamed(response);
    const record = await attempt(threads.turns(session), {
      reads,
      execute: { session, autonomy, clock, proposals },
      onStage: (stage: Stage) => {
        emit(stage);
      },
      ...(sources.mandate === undefined ? {} : { mandate: sources.mandate }),
      ...(sources.files === undefined ? {} : { files: sources.files }),
    });
    threads.answered(session, record.answer);
    emit({ attempt: withoutWords(record) });
    response.end();
  };

  const served = async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
  ): Promise<void> => {
    if (path === '/api/state') {
      json(response, 200, await state.read());
      return;
    }
    if (path === '/api/execute') {
      json(response, 200, switchState(sessionOf(request)));
      return;
    }
    if (path === '/api/bids') {
      json(response, 200, listBids());
      return;
    }
    if (path === '/api/attempts') {
      json(response, 200, listAttempts(attempts));
      return;
    }
    if (path === '/api/evidence') {
      json(response, 200, { evidence: evidenceTable(), authority: authorityTable() });
      return;
    }
    if (path.startsWith('/api/attempts/')) {
      const words = wordsOf(path.slice('/api/attempts/'.length), attempts);
      if (words === null) stated(response, 404, 'No attempt was recorded under that name.');
      else send(response, 200, 'text/plain; charset=utf-8', words);
      return;
    }
    stated(response, 404, 'There is nothing at that address.');
  };

  const route = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = new URL(request.url ?? '/', 'http://demo').pathname;
    const page = request.method === 'GET' ? PAGE[path] : undefined;
    if (page !== undefined) {
      const body = pageIn(publicDirectory, page.file);
      if (body === null) stated(response, 404, 'That part of the page is not built yet.');
      else send(response, 200, page.type, body);
      return;
    }
    if (request.method === 'POST' && path === '/api/attempt') return attemptFor(request, response);
    if (request.method === 'POST' && path === '/api/recipient')
      return recipientFor(request, response);
    if (request.method === 'POST' && path === '/api/execute') return switchFor(request, response);
    if (request.method === 'POST' && path === '/api/thread') {
      threads.forget(sessionOf(request));
      stated(
        response,
        200,
        'That conversation is closed. The next thing you say starts a new one.',
      );
      return;
    }
    if (request.method !== 'GET') {
      stated(response, 404, 'There is nothing at that address.');
      return;
    }
    return served(request, response, path);
  };

  /** A failure says which kind it was and never what it knows, so nothing of ours leaves. */
  const failed = (response: ServerResponse, cause: unknown): void => {
    const known = cause instanceof KeeperError;
    const says = known
      ? ERROR_COPY[cause.kind]
      : 'Something went wrong here, and this page is not guessing.';
    const extra = known && cause.kind === 'modelBusy' ? { retryAfterSeconds: WAIT_SECONDS } : {};
    if (response.headersSent) {
      streamed(response)({ error: { says, ...extra } });
      response.end();
      return;
    }
    stated(response, known ? (STATUS[cause.kind] ?? 500) : 500, says, extra);
  };

  const server = createServer((request, response) => {
    route(request, response).catch((cause: unknown) => {
      failed(response, cause);
    });
  });
  server.on('listening', () => {
    state.start();
  });
  server.on('close', () => {
    state.stop();
  });
  return server;
}
