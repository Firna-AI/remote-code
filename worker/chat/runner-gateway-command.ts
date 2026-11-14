import type { RunnerCommand } from '../../src/shared/generated/RunnerCommand'
import type { RunnerMessageDuringTurn } from '../../src/shared/generated/RunnerMessageDuringTurn'
import type { RunnerTurnCredential } from '../../src/shared/generated/RunnerTurnCredential'
import type { RunnerTurn } from '../../src/shared/generated/RunnerTurn'
import { chatGptSignInCopy } from '../../docs/mockups/src/components/settings/chatGptSignInCopy'
import type { WorkspaceTurnTokens } from '../model-gateway/workspace'
import type { AgentLogin } from './login-kind'
import { parseCodexTokens, parseCodexIdentity } from '../codex-auth/tokens'
import type { ResolvedCommand } from './types'

export function compatibilityFailure(login: AgentLogin): string {
  if (login.agent === 'codex' && login.kind === 'token')
    return 'This cloud computer cannot run Codex with ChatGPT. Ask an admin to build the org image again. Then start a new workspace. You can also connect an OpenAI API key.'
  return 'This cloud computer cannot use this agent login. Ask an admin to build the org image again. Then start a new workspace.'
}

/** The caller holds the chat queue and has committed the turn's running state. */
export async function gatewayRunnerCommand(
  command: ResolvedCommand,
  workspaceId: string,
  forRunningTurn: WorkspaceTurnTokens['forRunningTurn'],
): Promise<RunnerCommand | null> {
  if (command.type !== 'turn' && command.type !== 'message') return command
  const { login, ...fields } = command
  if (fields.type === 'message') {
    const message: RunnerMessageDuringTurn = fields
    return message
  }
  const token = await forRunningTurn(workspaceId, fields.turnId, login)
  if (!token) return null
  const turn: RunnerTurn = {
    ...fields,
    credential: nativeCredential(login, token),
  }
  return turn
}

function nativeCredential(
  login: AgentLogin,
  token: string,
): RunnerTurnCredential {
  if (login.agent === 'codex' && login.kind === 'token') {
    const stored = parseCodexTokens(login.secret)
    const account = stored ? parseCodexIdentity(stored.idToken) : null
    if (!stored || !account)
      throw new Error(chatGptSignInCopy.causes.notRenewed)
    return { agent: 'codex', kind: 'token', token, account }
  }
  return login.agent === 'codex'
    ? { agent: 'codex', kind: 'api-key', token }
    : {
        agent: 'claude',
        kind: login.kind === 'token' ? 'token' : 'api-key',
        token,
        ...(login.kind === 'endpoint' ? { promptCacheTtl: '1h' } : {}),
      }
}
