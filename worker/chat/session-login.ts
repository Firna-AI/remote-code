import type { Session } from '../../src/shared/generated/Session'
import type { Agent } from '../../src/shared/generated/Agent'

import { usableAgentLogin, type AgentLogin } from './login-kind'
import { LoginReuseDenied, readLogin } from './login-access'
import type { SessionLoginMetadata } from './login-availability'
import type { ChatOperation } from './operation'
import { sessionFor } from './session-record'
import type { ChatDependencies } from './types'

const unavailableMetadata: SessionLoginMetadata = {
  loginAvailable: false,
  loginShared: false,
}

export class SessionLogins {
  private readonly operation: ChatOperation
  private readonly dependencies: ChatDependencies

  constructor(operation: ChatOperation, dependencies: ChatDependencies) {
    this.operation = operation
    this.dependencies = dependencies
  }

  static async initial(
    dependencies: ChatDependencies,
    sessionId: string,
    userId: string,
    agent: Agent,
  ): Promise<SessionLoginMetadata> {
    const metadata = await dependencies.readLoginMetadata([
      { sessionId, userId, agent },
    ])
    return metadata.get(sessionId) ?? unavailableMetadata
  }

  async forMember(userId: string, agent: Agent) {
    const login = await readLogin(
      this.dependencies,
      userId,
      agent,
      undefined,
      userId,
    )
    return usableAgentLogin(login, this.dependencies.refusedEndpointDomains())
      ? login
      : null
  }

  async observe(
    sessionId: string,
    runnerTokenHash?: string,
    senderId?: string,
  ) {
    const session = await this.operation.read((view) =>
      sessionFor(view, sessionId),
    )
    let login: AgentLogin | null
    try {
      login = await readLogin(
        this.dependencies,
        session.startedBy?.id ?? null,
        session.choice.agent,
        runnerTokenHash,
        senderId,
      )
    } catch (error) {
      if (!(error instanceof LoginReuseDenied)) throw error
      await this.save(session, { loginAvailable: true, loginShared: false })
      return { session, login: null, reason: undefined }
    }
    const invalidEndpoint =
      login?.kind === 'endpoint' &&
      !usableAgentLogin(login, this.dependencies.refusedEndpointDomains())
    const metadata =
      login && session.startedBy && !invalidEndpoint
        ? await SessionLogins.initial(
            this.dependencies,
            session.id,
            session.startedBy.id,
            session.choice.agent,
          )
        : unavailableMetadata
    await this.save(session, metadata)
    const mayUseLogin =
      metadata.loginAvailable &&
      (metadata.loginShared ||
        senderId === undefined ||
        senderId === session.startedBy?.id)
    return {
      session,
      login: mayUseLogin ? login : null,
      reason: invalidEndpoint ? invalidEndpointMessage(session) : undefined,
    }
  }

  async metadata(sessionId: string): Promise<Session> {
    const session = await this.operation.read((view) =>
      sessionFor(view, sessionId),
    )
    await this.refresh([session])
    return session
  }

  async refresh(sessions?: readonly Session[]): Promise<void> {
    const open = (
      sessions ?? (await this.operation.read((view) => view.sessions()))
    ).filter((session) => session.closedAt === null)
    if (!open.length) return
    const targets = open.flatMap((session) =>
      session.startedBy === null
        ? []
        : [
            {
              sessionId: session.id,
              userId: session.startedBy.id,
              agent: session.choice.agent,
            },
          ],
    )
    const metadata = targets.length
      ? await this.dependencies.readLoginMetadata(targets)
      : new Map<string, SessionLoginMetadata>()
    for (const session of open)
      await this.save(session, metadata.get(session.id) ?? unavailableMetadata)
  }

  private async save(
    session: Session,
    metadata: SessionLoginMetadata,
  ): Promise<void> {
    if (
      session.loginAvailable !== metadata.loginAvailable ||
      session.loginShared !== metadata.loginShared
    ) {
      session.loginAvailable = metadata.loginAvailable
      session.loginShared = metadata.loginShared
      await this.operation.change(async (transaction) => {
        await transaction.saveSession(session)
        await transaction.emit({ type: 'session.updated', session })
      })
    }
  }
}

export function unavailableLoginMessage(session: Session): string {
  const starter = session.startedBy
  const owner = starter
    ? `${starter.displayName ?? starter.githubLogin}'s`
    : "The session's"
  const agent = session.choice.agent === 'claude' ? 'Claude' : 'Codex'
  if (session.loginAvailable && !session.loginShared)
    return `${owner} ${agent} login is for ${owner} messages only. Try again or send a new message.`
  return `${owner} ${agent} login is not available. Try again or send a new message.`
}

function invalidEndpointMessage(session: Session): string {
  const starter = session.startedBy
  const owner = starter
    ? `${starter.displayName ?? starter.githubLogin}'s`
    : "The session's"
  const agent = session.choice.agent === 'claude' ? 'Claude' : 'Codex'
  return `${owner} ${agent} login needs a public https:// endpoint with a host name. Update the login on the account page.`
}
