import { Brickken, PREPARE_PATH } from 'brickken-sdk';
import { fromPrivateKey } from 'brickken-sdk/adapters/private-key';

import { signerKey, type SignerRole } from '../chain/client.js';
import { BRICKKEN_API_BASE_URL } from '../shared/config.js';
import { readSecret } from '../shared/secrets.js';
import { API_KEY_VARIABLE } from './client.js';

export type {
  ApproveInput,
  CreateTokenizationInput,
  ExecuteInput,
  GrantMandateInput,
  MintTokenInput,
  UnsignedTransactionLike,
  WhitelistInput,
  WriteOptions,
  WriteResult,
} from 'brickken-sdk';

export { PREPARE_PATH };

/** This project never retries a paid write, so a failure is reported rather than repeated. */
const NO_RETRY = { attempts: 1, baseDelayMs: 0, jitter: false };

/** The only construction of the vendor client, so every call carries the same guarantees. */
export const sdkClient = (role: SignerRole): Brickken =>
  new Brickken({
    baseUrl: BRICKKEN_API_BASE_URL,
    apiKey: readSecret(API_KEY_VARIABLE),
    signer: fromPrivateKey(signerKey(role)),
    retry: NO_RETRY,
  });
