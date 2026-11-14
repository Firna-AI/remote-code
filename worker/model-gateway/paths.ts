import type { Agent } from '../../src/shared/generated/Agent'
import { MACHINE_PATHS } from '../../src/shared/agent-tools'
import type { AgentLoginKind } from '../chat/login-kind'

export const codexTokenPaths = {
  bundle: '/backend-api/wham/config/bundle',
  accounts: '/backend-api/wham/accounts/check',
  models: '/backend-api/codex/models',
  responses: '/backend-api/codex/responses',
} as const

export function gatewayPath(
  path: string,
): { agent: Agent; suffix: string } | null {
  for (const [agent, base] of [
    ['claude', MACHINE_PATHS.claudeGateway],
    ['codex', MACHINE_PATHS.codexGateway],
  ] as const) {
    if (path === base || path.startsWith(`${base}/`))
      return { agent, suffix: path.slice(base.length) }
  }
  return null
}

export function allowedModelRoute(
  agent: Agent,
  method: string,
  path: string,
  kind?: AgentLoginKind['kind'],
) {
  if (agent === 'claude')
    return (
      method === 'POST' &&
      (path === '/v1/messages' || path === '/v1/messages/count_tokens')
    )
  if (kind !== 'token' && method === 'POST' && path === '/responses')
    return true
  if (kind !== undefined && kind !== 'token') return false
  return method === 'POST'
    ? path === codexTokenPaths.responses
    : method === 'GET' &&
        [
          codexTokenPaths.bundle,
          codexTokenPaths.accounts,
          codexTokenPaths.models,
        ].some((allowed) => path === allowed)
}
