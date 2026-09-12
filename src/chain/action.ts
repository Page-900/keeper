import { MAX_TRANSACTION_VALUE, requireAddress } from '../shared/config.js';
import {
  EXECUTOR_ARTIFACT,
  MANDATE_ERRORS_ARTIFACT,
  ROUTER_ARTIFACT,
  compiledArtifact,
  withErrorsOf,
} from './artifacts.js';
import {
  callData,
  simulateCall,
  simulateRefusalAs,
  transferFromCalldata,
  type Artifact,
  type RevertReason,
} from './client.js';

export const agentCalldata = (to: `0x${string}`, amount: bigint): `0x${string}` =>
  transferFromCalldata(requireAddress('principal'), to, amount);

/** A revert can come from the router, the executor behind it, or the registry behind that. */
const routerPath = (): Artifact =>
  withErrorsOf(
    compiledArtifact(ROUTER_ARTIFACT),
    compiledArtifact(EXECUTOR_ARTIFACT),
    compiledArtifact(MANDATE_ERRORS_ARTIFACT),
  );

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
    requireAddress('router'),
    routerPath(),
    'execute',
    [requireAddress('asset'), agentCalldata(to, amount)],
    atBlock,
  );

const ROUTED = 'execute';

const routedArguments = ({ to, amount }: AgentAction): readonly unknown[] => [
  requireAddress('asset'),
  agentCalldata(to, amount),
];

/** The simulation and the send encode the same bytes here, or they drift and one of them lies. */
export const routedCalldata = (action: AgentAction): `0x${string}` =>
  callData(routerPath(), ROUTED, routedArguments(action));

/** Free, and it reverts for the same reason the real send would, so it runs first every time. */
export async function simulateAgentAction(action: AgentAction): Promise<void> {
  await simulateCall(
    'agent',
    requireAddress('router'),
    routerPath(),
    ROUTED,
    routedArguments(action),
  );
}
