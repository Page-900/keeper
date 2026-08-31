import { SUNL_DECIMALS, SUNL_SYMBOL } from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';

export interface ToolSpec {
  type: 'function';
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

export const PROPOSE_INTENT: ToolSpec = {
  type: 'function',
  name: 'propose_intent',
  description:
    `Propose what to do about the standing bid for ${SUNL_SYMBOL}. This proposes only. ` +
    'It cannot move anything. Deterministic code checks the proposal afterwards and may refuse it.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['deliver', 'decline'],
        description: 'deliver to sell into the bid, decline to sell nothing',
      },
      amountWholeTokens: {
        type: 'string',
        description: `whole ${SUNL_SYMBOL} to deliver, digits only, "0" when declining`,
      },
      pricePerToken: {
        type: 'string',
        description: 'BKN offered for one token, digits only, taken from the material',
      },
      recipient: {
        type: 'string',
        description: 'the settlement address to deliver to, or an empty string when declining',
      },
      rationale: {
        type: 'string',
        description: 'why, in plain words, including anything in the material you distrusted',
      },
    },
    required: ['action', 'amountWholeTokens', 'pricePerToken', 'recipient', 'rationale'],
    additionalProperties: false,
  },
};

interface Proposed {
  amount: bigint;
  pricePerToken: bigint;
  rationale: string;
}

export interface DeliverIntent extends Proposed {
  action: 'deliver';
  recipient: `0x${string}`;
}

export interface DeclineIntent extends Proposed {
  action: 'decline';
  recipient: null;
}

export type Intent = DeliverIntent | DeclineIntent;

const DIGITS = /^\d+$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const MAX_DIGITS = 30;
const MAX_RATIONALE = 4_000;

const refuse = (why: string): never => {
  throw new KeeperError('intentMalformed', why);
};

const field = (from: Record<string, unknown>, name: string): string => {
  const value = from[name];
  if (typeof value !== 'string') refuse(`${name} is not a string`);
  return value as string;
};

const wholeNumber = (raw: string, name: string): bigint => {
  if (!DIGITS.test(raw)) refuse(`${name} is not a whole number`);
  if (raw.length > MAX_DIGITS) refuse(`${name} has too many digits to be a real amount`);
  return BigInt(raw);
};

function readAction(raw: string): Intent['action'] {
  if (raw === 'deliver' || raw === 'decline') return raw;
  return refuse(`action "${raw}" is not one we have`);
}

/** The model is not trusted, and neither is the schema the vendor promises to enforce. */
export function readIntent(raw: unknown): Intent {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return refuse('the proposal is not an object');
  const from = raw as Record<string, unknown>;

  const action = readAction(field(from, 'action'));

  const rationale = field(from, 'rationale').trim();
  if (rationale === '') refuse('rationale is empty');
  if (rationale.length > MAX_RATIONALE) refuse('rationale is longer than we accept');

  const amount = wholeNumber(field(from, 'amountWholeTokens'), 'amountWholeTokens');
  const pricePerToken = wholeNumber(field(from, 'pricePerToken'), 'pricePerToken');
  const recipient = field(from, 'recipient');

  if (action === 'decline') {
    if (amount !== 0n) refuse('a decline cannot carry an amount');
    return { action, amount: 0n, pricePerToken, recipient: null, rationale };
  }

  if (amount === 0n) refuse('a delivery of nothing is a decline, and must say so');
  if (!ADDRESS.test(recipient)) refuse('recipient is not an address');
  return {
    action,
    amount: amount * 10n ** BigInt(SUNL_DECIMALS),
    pricePerToken,
    recipient: recipient as `0x${string}`,
    rationale,
  };
}
