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
  attackBoxOff,
  attemptsRecordedOn,
  createLimits,
  utcDay,
  type Limits,
} from './limits.js';
import { ATTEMPT_FILE, listAttempts, withoutWords, wordsOf } from './log.js';
import { createThreads, type Threads } from './thread.js';
import { authorityTable, demoView, evidenceTable } from './view.js';
import { warmed } from './warm.js';

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
  threads?: Threads;
  limits?: Limits;
  files?: AttemptFiles;
  publicDirectory?: string;
  now?: () => number;
}

const PAGE: Readonly<Record<string, { file: string; type: string }>> = Object.freeze({
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/ui.js': { file: 'ui.js', type: 'text/javascript; charset=utf-8' },
  '/chat.js': { file: 'chat.js', type: 'text/javascript; charset=utf-8' },
  '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
});

const send = (response: ServerResponse, status: number, type: string, body: string): void => {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
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
    response.writeHead(200, { 'content-type': NDJSON, 'cache-control': 'no-store' });
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
    limits = createLimits(),
    threads = createThreads(),
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
