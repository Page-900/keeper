export const ERROR_COPY = {
  addressUnissued: 'Brickken onboarding has not issued this address yet',
  secretMissing: 'A required value is missing from app/.env',
  secretMalformed: 'A value in app/.env is not in the form this project requires',
  secretExists: 'A value in app/.env is already set, and this project never overwrites one',
  wrongChain: 'The network endpoint serves a different chain than this project is allowed to use',
  brickkenUnreachable: 'The Brickken API could not be reached',
  brickkenRejected: 'The Brickken API refused the request',
  brickkenRateLimited: 'The Brickken API rate limit was reached, and this project never retries',
  brickkenUnreadable: 'The Brickken API returned a body this project cannot read',
  sequenceMalformed: 'A prepared sequence of transactions cannot be submitted as it stands',
  nonceGap: 'A prepared sequence is missing a nonce, and this project never skips ahead',
  writeUnconfirmed: 'A write could not be shown to have landed, so the sequence stopped there',
  readBackMismatch: 'The chain reports something other than what this project meant to write',
  alreadyDeployed: 'This contract is deployed once, and the evidence log already records that',
  artifactUnusable: 'The compiled contract could not be read, so there is nothing to deploy',
} as const;

export type ErrorKind = keyof typeof ERROR_COPY;

export class KeeperError extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly detail: string,
  ) {
    super(`${ERROR_COPY[kind]}: ${detail}`);
    this.name = 'KeeperError';
  }
}
