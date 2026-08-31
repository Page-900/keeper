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
  argumentUnsafe: 'An argument cannot be passed to a shell, so the command was not run',
  intentMalformed: 'The proposal does not match the shape this project accepts, so it was refused',
  fenceBroken: 'Untrusted text carries the marker meant to fence it, so it was not sent',
  modelUnreachable: 'The model could not be reached, and no other model is asked in its place',
  writeUnconfirmed: 'A write could not be shown to have landed, so nothing depending on it ran',
  readBackMismatch: 'The chain reports something other than what this project meant to write',
  alreadyDeployed: 'This contract is deployed once, and the evidence log already records that',
  artifactUnusable: 'The compiled contract could not be read',
  payloadMismatch: 'Brickken describe the authority differently from the way this project does',
  brickkenUnsettled: 'Brickken has not reported a transaction hash for this write yet',
  alreadyCreated: 'This token is created once, and the evidence log already records that',
  refusalUnattributable:
    'A refusal could not be pinned to a single published limit, so nothing was recorded',
  actionRefused: 'This call was tried for free first and did not go through, so nothing was sent',
  evidenceProtected: 'A test tried to write into the evidence a real run produced',
  offeringBroadcast: 'A prepare that must open nothing reported a send or left an offering',
  skillUnverified:
    'The Brickken agent skill on this machine is not the artifact the evidence recorded',
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
