import type { Agent } from '../../src/shared/generated/Agent'
import type { AppEnv } from '../env'
import { HttpError } from '../http'
import { readAgentLogin, senderLoginAccess } from './queries'
import type { ChatDependencies } from './types'

/** This failure closes the runner and leaves its commands queued. */
export class RunnerAccessDenied extends Error {}

/** Reuse can be refused while the starter's own login stays available. */
export class LoginReuseDenied extends Error {}

export class SenderAccessDenied extends HttpError {
  constructor() {
    super(
      409,
      'agent_login_required',
      'The message sender no longer has access to this workspace.',
    )
  }
}

export async function readLogin(
  dependencies: ChatDependencies,
  userId: string | null,
  agent: Agent,
  runnerTokenHash?: string,
  senderId?: string,
) {
  const login = await dependencies.resolveLogin(
    userId,
    agent,
    runnerTokenHash,
    senderId,
  )
  return login?.agent === agent ? login : null
}

export function loginResolver(
  env: AppEnv,
  workspaceId: () => string | null,
  override?: ChatDependencies['resolveLogin'],
): ChatDependencies['resolveLogin'] {
  const read: ChatDependencies['resolveLogin'] =
    override ??
    ((userId, agent) =>
      userId === null
        ? Promise.resolve(null)
        : readAgentLogin(env, userId, agent))
  return async (userId, agent, runnerTokenHash, senderId) => {
    const id = workspaceId()
    if (!id) return null
    const access = await senderLoginAccess(
      env.DB,
      id,
      userId,
      agent,
      runnerTokenHash,
      senderId,
    )
    if (runnerTokenHash !== undefined && !access.runnerAllowed)
      throw new RunnerAccessDenied()
    if (senderId !== undefined && !access.senderAllowed)
      throw new SenderAccessDenied()
    if (!access.loginOwnerAllowed || userId === null) return null
    if (!access.reuseAllowed) throw new LoginReuseDenied()
    const login = await read(userId, agent, runnerTokenHash, senderId)
    return login
  }
}
