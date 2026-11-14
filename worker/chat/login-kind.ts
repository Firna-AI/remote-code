import type { Agent } from '../../src/shared/generated/Agent'
import type { RunnerLogin } from '../../src/shared/generated/RunnerLogin'
import type { RunnerLoginKind } from '../../src/shared/generated/RunnerLoginKind'
import { readEndpointAddress } from '../../src/shared/endpoint-address'

export type AgentLoginKind =
  RunnerLoginKind | { agent: Agent; kind: 'endpoint' }

export function agentLoginKind(
  agent: Agent,
  kind: string,
): AgentLoginKind | null {
  if (kind === 'endpoint' || kind === 'token' || kind === 'api-key')
    return { agent, kind }
  return null
}

export type AgentLogin =
  | RunnerLogin
  | { agent: Agent; kind: 'endpoint'; endpoint: string; secret: string }

export function usableAgentLogin(
  login: AgentLogin | null,
  refusedDomains: readonly string[] = [],
): boolean {
  return (
    login !== null &&
    (login.kind !== 'endpoint' ||
      readEndpointAddress(login.endpoint, login.agent, { refusedDomains }) !==
        null)
  )
}
