import { BRICKKEN_API_BASE_URL } from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { appendRecord } from '../shared/jsonl.js';
import { readSecret, registerSecret, scrub, scrubError } from '../shared/secrets.js';
import { EVIDENCE_FILE, type RequestRecord } from './log.js';

const API_KEY_VARIABLE = 'BRICKKEN_API_KEY';

/** GET /get-token-info echoes tokenizer emails back, so this one has to be redactable. */
const TOKENIZER_EMAIL_VARIABLE = 'TOKENIZER_EMAIL';

/** What GET /get-token-info returns. It carries no balances. */
export interface TokenInfo {
  tokenSymbols: string[];
  tokenizerEmails: string[];
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isTokenInfo = (body: unknown): body is TokenInfo =>
  typeof body === 'object' &&
  body !== null &&
  isStringArray((body as Partial<TokenInfo>).tokenSymbols) &&
  isStringArray((body as Partial<TokenInfo>).tokenizerEmails);

const EXPLANATION_LIMIT = 300;

/** A refusal without the API's own reason costs a round trip to guess at. */
async function explanation(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  return body === '' ? '' : `: ${scrub(body).slice(0, EXPLANATION_LIMIT)}`;
}

async function getJson(
  logFile: string,
  path: string,
  query: Record<string, string>,
): Promise<unknown> {
  const key = readSecret(API_KEY_VARIABLE);
  registerSecret(TOKENIZER_EMAIL_VARIABLE);
  const url = new URL(path, BRICKKEN_API_BASE_URL);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const attempt = {
    at: new Date().toISOString(),
    surface: 'rest',
    method: 'GET',
    path: `${path}${url.search}`,
  } as const;

  let response: Response;
  try {
    response = await fetch(url, { headers: { 'x-api-key': key } });
  } catch (cause) {
    const unreachable: RequestRecord = { ...attempt, outcome: 'failure' };
    appendRecord(logFile, unreachable);
    throw new KeeperError('brickkenUnreachable', `GET ${path}: ${scrubError(cause).message}`);
  }

  const answered: RequestRecord = {
    ...attempt,
    outcome: response.ok ? 'success' : 'failure',
    status: response.status,
  };
  appendRecord(logFile, answered);

  // Retry-After is reported, never obeyed: this client does not retry.
  if (response.status === 429) {
    const after = response.headers.get('retry-after') ?? 'no Retry-After header';
    throw new KeeperError('brickkenRateLimited', `GET ${path} (${after})`);
  }
  if (!response.ok) {
    throw new KeeperError(
      'brickkenRejected',
      `GET ${path} returned HTTP ${String(response.status)}${await explanation(response)}`,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new KeeperError('brickkenUnreadable', `GET ${path} returned a body that is not JSON`);
  }
}

export interface BrickkenClient {
  getTokenInfo(tokenSymbol: string): Promise<TokenInfo>;
}

/** The only door to Brickken. */
export function createBrickkenClient(logFile: string = EVIDENCE_FILE): BrickkenClient {
  return {
    async getTokenInfo(tokenSymbol) {
      const body = await getJson(logFile, '/get-token-info', { tokenSymbol });
      if (!isTokenInfo(body)) {
        throw new KeeperError(
          'brickkenUnreadable',
          'GET /get-token-info returned no tokenSymbols and tokenizerEmails arrays',
        );
      }
      return body;
    },
  };
}
