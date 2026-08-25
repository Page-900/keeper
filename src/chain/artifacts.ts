import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { KeeperError } from '../shared/errors.js';
import { scrubError } from '../shared/secrets.js';
import type { Artifact } from './client.js';

const compiled = (path: string): string =>
  fileURLToPath(new URL(`../../artifacts/contracts/${path}`, import.meta.url));

export const EXECUTOR_ARTIFACT = compiled('AgentExecutor.sol/AgentExecutor.json');

export const REGISTRY_ARTIFACT = compiled('interfaces/IAgentMandate.sol/IAgentMandate.json');

export const ROLES_ARTIFACT = compiled('interfaces/IMandateRoles.sol/IMandateRoles.json');

export const COMPLIANCE_ARTIFACT = compiled(
  'interfaces/IComplianceProvider.sol/IComplianceProvider.json',
);

/** The compiler is the only source of the bytecode and the interface, so neither can drift. */
export function compiledArtifact(file: string): Artifact {
  let parsed: Partial<Artifact>;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Artifact>;
  } catch (cause) {
    throw new KeeperError('artifactUnusable', `${file}: ${scrubError(cause).message}`);
  }
  const { abi, bytecode } = parsed;
  if (!Array.isArray(abi) || typeof bytecode !== 'string' || !bytecode.startsWith('0x'))
    throw new KeeperError('artifactUnusable', `${file} holds no compiled contract`);
  return { abi, bytecode };
}
