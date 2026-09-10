import {
  GRANT_MANDATE_TYPES,
  REVOKE_MANDATE_TYPES,
  grantMandateTypedData,
  revokeMandateTypedData,
  typedDataDigest,
  type GrantMandateMessage,
  type RevokeMandateMessage,
  type TypedDataDomain,
} from '../chain/mandate.js';
import { KeeperError } from '../shared/errors.js';

export interface TypedDataEnvelope {
  domain: TypedDataDomain;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface Named {
  primaryType: string;
  path: string;
  fields: readonly { name: string; type: string }[];
}

export interface Shape<Message> extends Named {
  ours: (message: Message) => TypedDataEnvelope;
}

const envelopeOf = (built: {
  domain: TypedDataDomain;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: unknown;
}): TypedDataEnvelope => ({
  domain: built.domain,
  types: built.types,
  primaryType: built.primaryType,
  message: built.message as Record<string, unknown>,
});

export const GRANT: Shape<GrantMandateMessage> = {
  primaryType: 'GrantMandate',
  path: 'grant-mandate',
  fields: GRANT_MANDATE_TYPES.GrantMandate,
  ours: (message) => envelopeOf(grantMandateTypedData(message)),
};

export const REVOKE: Shape<RevokeMandateMessage> = {
  primaryType: 'RevokeMandate',
  path: 'revoke-mandate',
  fields: REVOKE_MANDATE_TYPES.RevokeMandate,
  ours: (message) => envelopeOf(revokeMandateTypedData(message)),
};

const unreadable = (shape: Named, what: string): KeeperError =>
  new KeeperError('brickkenUnreadable', `GET /rams/typed-data/${shape.path} ${what}`);

const object = (value: unknown, what: string, shape: Named): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw unreadable(shape, `carries no ${what}`);
  return value as Record<string, unknown>;
};

export function readTypedData(body: unknown, shape: Named): TypedDataEnvelope {
  const envelope = object(object(body, 'body', shape)['typedData'], 'typedData', shape);
  const { domain, types, primaryType, message } = envelope;
  if (primaryType !== shape.primaryType) throw unreadable(shape, `is for ${String(primaryType)}`);
  return {
    domain: object(domain, 'domain', shape),
    types: object(types, 'types', shape) as TypedDataEnvelope['types'],
    primaryType,
    message: object(message, 'message', shape),
  };
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.toLowerCase() : String(value);

const differs = (field: string, ours: unknown, theirs: unknown): KeeperError =>
  new KeeperError(
    'payloadMismatch',
    `${field}: this project says ${text(ours)}, Brickken say ${text(theirs)}`,
  );

function compareTypes(shape: Named, theirs: TypedDataEnvelope['types']): void {
  const listed = theirs[shape.primaryType] ?? [];
  if (listed.length !== shape.fields.length)
    throw differs('the field count', shape.fields.length, listed.length);
  shape.fields.forEach((field, index) => {
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

function compareMessage(
  shape: Named,
  ours: Record<string, unknown>,
  theirs: Record<string, unknown>,
): void {
  for (const { name } of shape.fields) {
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
export function requireSamePayload<Message>(
  ours: Message,
  ourDomain: TypedDataDomain,
  theirs: TypedDataEnvelope,
  shape: Shape<Message>,
): `0x${string}` {
  compareTypes(shape, theirs.types);
  compareDomain(ourDomain, theirs.domain);
  compareMessage(shape, ours as Record<string, unknown>, theirs.message);

  const ourDigest = typedDataDigest(shape.ours(ours));
  const theirDigest = typedDataDigest(theirs);
  if (ourDigest !== theirDigest) throw differs('the digest', ourDigest, theirDigest);
  return ourDigest;
}
