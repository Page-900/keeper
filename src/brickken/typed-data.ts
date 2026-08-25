import {
  GRANT_MANDATE_TYPES,
  grantMandateDigest,
  typedDataDigest,
  type GrantMandateMessage,
  type TypedDataDomain,
} from '../chain/mandate.js';
import { KeeperError } from '../shared/errors.js';

export interface TypedDataEnvelope {
  domain: TypedDataDomain;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

const unreadable = (what: string): KeeperError =>
  new KeeperError('brickkenUnreadable', `GET /rams/typed-data/grant-mandate ${what}`);

const object = (value: unknown, what: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw unreadable(`carries no ${what}`);
  return value as Record<string, unknown>;
};

export function readTypedData(body: unknown): TypedDataEnvelope {
  const envelope = object(object(body, 'body')['typedData'], 'typedData');
  const { domain, types, primaryType, message } = envelope;
  if (primaryType !== 'GrantMandate') throw unreadable(`is for ${String(primaryType)}`);
  return {
    domain: object(domain, 'domain'),
    types: object(types, 'types') as TypedDataEnvelope['types'],
    primaryType,
    message: object(message, 'message'),
  };
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.toLowerCase() : String(value);

const differs = (field: string, ours: unknown, theirs: unknown): KeeperError =>
  new KeeperError(
    'payloadMismatch',
    `${field}: this project says ${text(ours)}, Brickken say ${text(theirs)}`,
  );

function compareTypes(theirs: TypedDataEnvelope['types']): void {
  const ours = GRANT_MANDATE_TYPES.GrantMandate;
  const listed = theirs['GrantMandate'] ?? [];
  if (listed.length !== ours.length) throw differs('the field count', ours.length, listed.length);
  ours.forEach((field, index) => {
    const found = listed[index];
    if (found?.name !== field.name || found.type !== field.type)
      throw differs(`field ${String(index)}`, `${field.name} ${field.type}`, JSON.stringify(found));
  });
}

function compareDomain(ours: TypedDataDomain, theirs: TypedDataDomain): void {
  for (const field of ['name', 'version', 'chainId', 'verifyingContract'] as const) {
    if (text(ours[field]) !== text(theirs[field]))
      throw differs(`domain ${field}`, ours[field], theirs[field]);
  }
}

function compareMessage(ours: GrantMandateMessage, theirs: Record<string, unknown>): void {
  for (const { name } of GRANT_MANDATE_TYPES.GrantMandate) {
    const mine = ours[name];
    const yours = theirs[name];
    const same = Array.isArray(mine)
      ? Array.isArray(yours) &&
        mine.length === yours.length &&
        mine.every((item, index) => text(item) === text(yours[index]))
      : text(mine) === text(yours);
    if (!same) throw differs(name, mine, yours);
  }
}

/** Keeper's whole argument is that an agent is not trusted on its own account. Nor is an API. */
export function requireSamePayload(
  ours: GrantMandateMessage,
  ourDomain: TypedDataDomain,
  theirs: TypedDataEnvelope,
): `0x${string}` {
  compareTypes(theirs.types);
  compareDomain(ourDomain, theirs.domain);
  compareMessage(ours, theirs.message);

  const ourDigest = grantMandateDigest(ours);
  const theirDigest = typedDataDigest(theirs);
  if (ourDigest !== theirDigest) throw differs('the digest', ourDigest, theirDigest);
  return ourDigest;
}
