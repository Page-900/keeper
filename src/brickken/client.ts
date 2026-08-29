import { BRICKKEN_API_BASE_URL } from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';
import { appendRecord } from '../shared/jsonl.js';
import { readSecret, registerSecret, scrub, scrubError } from '../shared/secrets.js';
import { EVIDENCE_FILE, type RequestRecord } from './log.js';

export const API_KEY_VARIABLE = 'BRICKKEN_API_KEY';

/** GET /get-token-info echoes tokenizer emails back, so this one has to be redactable. */
export const TOKENIZER_EMAIL_VARIABLE = 'TOKENIZER_EMAIL';

/** What GET /get-token-info returns. It carries no balances and no contract address. */
export interface TokenInfo {
  tokenSymbol: string;
  tokenName: string;
  decimals: number;
  maxSupply: number;
  companyWallet: string;
}

/** The tokenizer email comes back in the same body and is deliberately not carried out of here. */
function readTokenInfo(body: unknown): TokenInfo {
  const found = (body ?? {}) as Record<string, unknown>;
  const missing = (field: string): KeeperError =>
    new KeeperError('brickkenUnreadable', `GET /get-token-info carries no ${field}`);
  const text = (field: string): string => {
    const value = found[field];
    if (typeof value !== 'string') throw missing(field);
    return value;
  };
  const count = (field: string): number => {
    const value = found[field];
    if (typeof value !== 'number') throw missing(field);
    return value;
  };
  return {
    tokenSymbol: text('tokenSymbol'),
    tokenName: text('tokenName'),
    decimals: count('allowedTokenDecimals'),
    maxSupply: count('maxTokenSupply'),
    companyWallet: text('companyWalletAddress'),
  };
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BASE_UNITS = /^\d+$/;

function readHolder(body: unknown): HolderRecord {
  const found = (body ?? {}) as Record<string, unknown>;
  const missing = (field: string): KeeperError =>
    new KeeperError('brickkenUnreadable', `GET /get-balance-whitelist carries no ${field}`);
  const wallet = found['walletAddress'];
  const raw = found['tokenBalanceRaw'];
  const cleared = found['isWhitelisted'];
  if (typeof wallet !== 'string' || !ADDRESS.test(wallet)) throw missing('wallet address');
  if (typeof raw !== 'string' || !BASE_UNITS.test(raw)) throw missing('balance in base units');
  if (typeof cleared !== 'boolean') throw missing('whitelist answer');
  const source = found['balanceSource'];
  return {
    walletAddress: wallet,
    balance: BigInt(raw),
    isWhitelisted: cleared,
    balanceSource: typeof source === 'string' ? source : 'unstated',
  };
}

const REPORTED = ['pending', 'success', 'rejected'] as const;

const isHash = (value: unknown): value is `0x${string}` =>
  typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);

function readStatus(body: unknown): TransactionStatus {
  const reported = (body as Record<string, unknown> | null)?.['status'];
  const hash = (body as Record<string, unknown> | null)?.['transactionHash'];
  const found = REPORTED.find((allowed) => allowed === reported);
  if (found === undefined)
    throw new KeeperError('brickkenUnreadable', 'GET /get-transaction-status reported no status');
  return { status: found, transactionHash: isHash(hash) ? hash : null };
}

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
  logged: Partial<Pick<RequestRecord, 'path' | 'txId'>> = {},
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
    ...logged,
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

/** What GET /get-transaction-status returns, and the only trustworthy source of the hash. */
export interface TransactionStatus {
  status: 'pending' | 'success' | 'rejected';
  transactionHash: `0x${string}` | null;
}

/** Their own answer carries where they read it from, so a cached yes is distinguishable. */
export interface WhitelistStatus {
  isWhitelisted: boolean;
  source: string;
}

export interface HolderRecord {
  walletAddress: string;
  balance: bigint;
  isWhitelisted: boolean;
  /** Documented as "blockchain", so their balance is our own source read through theirs. */
  balanceSource: string;
}

export interface BrickkenClient {
  getTokenInfo(tokenSymbol: string): Promise<TokenInfo>;
  getBalanceWhitelist(tokenSymbol: string, investorEmail: string): Promise<HolderRecord>;
  getTransactionStatus(txId: string): Promise<TransactionStatus>;
  getWhitelistStatus(tokenSymbol: string, investorAddress: string): Promise<WhitelistStatus>;
  listOfferings(tokenSymbol: string): Promise<unknown[]>;
  countOfferings(tokenSymbol: string): Promise<number>;
  getRamsStatus(query: Record<string, string>): Promise<unknown>;
  getGrantMandateTypedData(query: Record<string, string>): Promise<unknown>;
}

/** The only door to Brickken. */
export function createBrickkenClient(logFile: string = EVIDENCE_FILE): BrickkenClient {
  return {
    async getTokenInfo(tokenSymbol) {
      const body = await getJson(logFile, '/get-token-info', { tokenSymbol });
      return readTokenInfo(body);
    },
    async getBalanceWhitelist(tokenSymbol, investorEmail) {
      const body = await getJson(logFile, '/get-balance-whitelist', { tokenSymbol, investorEmail });
      return readHolder(body);
    },
    async getWhitelistStatus(tokenSymbol, investorAddress) {
      const body = await getJson(logFile, '/get-whitelist-status', {
        tokenSymbol,
        investorAddress,
      });
      const found = (body ?? {}) as Record<string, unknown>;
      if (typeof found['isWhitelisted'] !== 'boolean')
        throw new KeeperError('brickkenUnreadable', 'GET /get-whitelist-status gave no answer');
      return {
        isWhitelisted: found['isWhitelisted'],
        source: typeof found['source'] === 'string' ? found['source'] : 'unstated',
      };
    },
    async getTransactionStatus(txId) {
      const path = '/get-transaction-status';
      const body = await getJson(logFile, path, { txId }, { path, txId });
      return readStatus(body);
    },
    async listOfferings(tokenSymbol) {
      const body: unknown = await getJson(logFile, '/get-stos', { tokenSymbol });
      if (!Array.isArray(body))
        throw new KeeperError('brickkenUnreadable', 'GET /get-stos did not return a list');
      const listed: unknown[] = body;
      return listed;
    },
    async countOfferings(tokenSymbol) {
      return (await this.listOfferings(tokenSymbol)).length;
    },
    getRamsStatus(query) {
      return getJson(logFile, '/rams/status', { ...query });
    },
    getGrantMandateTypedData(query) {
      return getJson(logFile, '/rams/typed-data/grant-mandate', query);
    },
  };
}
