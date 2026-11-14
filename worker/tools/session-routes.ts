import type { AgentReadSessionRequest } from '../../src/shared/generated/AgentReadSessionRequest'
import { MACHINE_PATHS } from '../../src/shared/agent-tools'

import { sessionTitleFrom } from '../../src/shared/session-title'
import { HttpError } from '../http'
import { counter, identifier, invalidInput } from '../chat/inputs'
import type { AgentToolServices } from './services'
import type { CallingWorkspace } from './store'
import { toolSessionWorkspace } from './session-access'
import { readJsonObject } from '../http/json-body'
import { TOOL_TURN_HEADER } from '../../src/shared/agent-tools'
import { requireCallingToolTurn } from './calling-turn'
import { createSessionInput, sendSessionInput } from './session-input'
import { sessionPageInput } from './session-page'

const SESSION_ROUTE = new RegExp(
  `^${MACHINE_PATHS.workspaces}/([^/]+)/sessions(?:/([^/]+)(?:/(transcript|rename|close|stop)|/messages(?:/([^/]+))?)?)?$`,
)

type SessionToolAction =
  | 'sessions'
  | 'transcript'
  | 'message'
  | 'send'
  | 'get'
  | 'rename'
  | 'close'
  | 'stop'

function route(path: string) {
  const match = path.match(SESSION_ROUTE)
  if (!match) return null
  let action: SessionToolAction
  switch (match[3]) {
    case 'transcript':
    case 'rename':
    case 'close':
    case 'stop':
      action = match[3]
      break
    default:
      action = match[4]
        ? 'message'
        : match[2]
          ? path.endsWith('/messages')
            ? 'send'
            : 'get'
          : 'sessions'
  }
  return {
    workspaceId: match[1],
    sessionId: match[2],
    messageId: match[4],
    action,
  }
}

export function isAgentSessionPath(path: string): boolean {
  return route(path) !== null
}

export function sessionToolMethods(path: string): string[] | null {
  const matched = route(path)
  return !matched
    ? null
    : matched.action === 'sessions'
      ? ['GET', 'POST']
      : ['transcript', 'get', 'message'].includes(matched.action)
        ? ['GET']
        : ['POST']
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new HttpError(
      404,
      'workspace_not_found',
      'The workspace is not available.',
    )
  }
}

function readOptions(query: URLSearchParams): AgentReadSessionRequest {
  const detail = query.get('detail') ?? 'concise'
  if (detail !== 'concise' && detail !== 'full') return invalidInput()
  const start = query.get('startLine')
  const offset = query.get('startOffset')
  return {
    detail,
    ...(start !== null && { startLine: Math.max(1, counter(Number(start))) }),
    ...(offset !== null && { startOffset: counter(Number(offset)) }),
  }
}

export async function readSessionsFromTool(
  url: URL,
  db: D1Database,
  caller: CallingWorkspace,
  origin: string,
  services: AgentToolServices,
) {
  const match = route(url.pathname)
  if (
    !match ||
    !['sessions', 'get', 'message', 'transcript'].includes(match.action)
  )
    return null
  const workspaceId =
    match.workspaceId === 'current'
      ? caller.workspaceId
      : decode(match.workspaceId)
  await toolSessionWorkspace(db, caller.orgId, workspaceId, origin)
  if (match.action === 'sessions')
    return services.listSessions(
      caller.orgId,
      workspaceId,
      sessionPageInput(url.searchParams),
    )
  const sessionId = decode(match.sessionId)
  if (match.action === 'get')
    return services.getSession(caller.orgId, workspaceId, sessionId)
  if (match.action === 'message')
    return services.getMessage(
      caller.orgId,
      workspaceId,
      sessionId,
      decode(match.messageId),
    )
  return services.readSession(
    caller.orgId,
    workspaceId,
    sessionId,
    readOptions(url.searchParams),
  )
}

export async function writeSessionsFromTool(
  request: Request,
  url: URL,
  db: D1Database,
  caller: CallingWorkspace,
  services: AgentToolServices,
) {
  const match = route(url.pathname)
  if (!match || ['get', 'message', 'transcript'].includes(match.action))
    return null
  const { turn } = await requireCallingToolTurn(
    db,
    caller,
    request.headers.get(TOOL_TURN_HEADER),
    services,
  )
  const body: Record<string, unknown> =
    match.action === 'stop' ? {} : await readJsonObject(request)
  const workspaceId =
    match.workspaceId === 'current'
      ? caller.workspaceId
      : decode(match.workspaceId)
  const context = {
    orgId: caller.orgId,
    workspaceId,
    callerWorkspaceId: caller.workspaceId,
    callerSessionId: turn.sessionId,
    senderUserId: turn.senderUserId,
  }
  if (['rename', 'close', 'stop'].includes(match.action)) {
    if (
      match.action === 'close' &&
      body.stopRunningTurn !== undefined &&
      typeof body.stopRunningTurn !== 'boolean'
    )
      return invalidInput()
    const operation =
      match.action === 'rename'
        ? {
            kind: 'rename' as const,
            title: sessionTitleFrom(identifier(body.title)) ?? invalidInput(),
          }
        : match.action === 'close'
          ? {
              kind: 'close' as const,
              stopRunningTurn: body.stopRunningTurn === true,
            }
          : { kind: 'stop' as const }
    return Response.json(
      await services.manageSession({
        ...context,
        sessionId: decode(match.sessionId),
        ...operation,
      }),
    )
  }
  const operation =
    match.action === 'send'
      ? {
          kind: 'send' as const,
          sessionId: decode(match.sessionId),
          input: sendSessionInput(body),
        }
      : { kind: 'create' as const, input: createSessionInput(body) }
  const result = await services.writeSession({
    ...context,
    ...operation,
    requestId: operation.input.requestId ?? crypto.randomUUID(),
  })
  return Response.json(result, {
    status: operation.kind === 'create' ? 201 : 202,
  })
}
