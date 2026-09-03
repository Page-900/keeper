import { MAX_TRANSACTION_VALUE, requireAddress } from '../shared/config.js';
import { EXECUTOR_ARTIFACT, compiledArtifact } from './artifacts.js';
import {
  simulateCall,
  simulateRefusalAs,
  transferFromCalldata,
  type RevertReason,
} from './client.js';

export const agentCalldata = (to: `0x${string}`, amount: bigint): `0x${string}` =>
  transferFromCalldata(requireAddress('principal'), to, amount);

export interface AgentAction {
  to: `0x${string}`;
  amount: bigint;
}

export const firstAction = (): AgentAction => ({
  to: requireAddress('counterparty'),
  amount: MAX_TRANSACTION_VALUE,
});

/** No key, so the page can ask it. The revert is returned rather than thrown, to be read out. */
export const agentActionRefusal = (
  { to, amount }: AgentAction,
  atBlock?: bigint,
): Promise<RevertReason | null> =>
  simulateRefusalAs(
    requireAddress('agent'),
    requireAddress('executor'),
    compiledArtifact(EXECUTOR_ARTIFACT),
    'execute',
    [requireAddress('asset'), agentCalldata(to, amount)],
    atBlock,
  );

/** Free, and it reverts for the same reason the real send would, so it runs first every time. */
export async function simulateAgentAction({ to, amount }: AgentAction): Promise<void> {
  await simulateCall(
    'agent',
    requireAddress('executor'),
    compiledArtifact(EXECUTOR_ARTIFACT),
    'execute',
    [requireAddress('asset'), agentCalldata(to, amount)],
  );
}
