import { signerAddress, type SignerRole } from '../chain/client.js';
import { readSecret } from '../shared/secrets.js';
import { TOKENIZER_EMAIL_VARIABLE } from './client.js';

/** Whoever creates the token keeps its mint and whitelist powers for life, so never the agent. */
export const TOKENIZER: SignerRole = 'principal';

export const tokenizerAddress = (): `0x${string}` => signerAddress(TOKENIZER);

export const tokenizerEmail = (): string => readSecret(TOKENIZER_EMAIL_VARIABLE);
