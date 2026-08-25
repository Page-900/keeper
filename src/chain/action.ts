import { MAX_TRANSACTION_VALUE, requireAddress } from '../shared/config.js';
import { EXECUTOR_ARTIFACT, compiledArtifact } from './artifacts.js';
import { simulateCall, transferCalldata } from './client.js';

export const agentCalldata = (to: `0x${string}`, amount: bigint): `0x${string}` =>
  transferCalldata(requireAddress('principal'), to, amount);

export interface AgentAction {
  to: `0x${string}`;
  amount: bigint;
}

export const firstAction = (): AgentAction => ({
  to: requireAddress('counterparty'),
  amount: MAX_TRANSACTION_VALUE,
});

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
