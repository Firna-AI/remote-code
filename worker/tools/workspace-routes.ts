import type { AgentWorkspaceResponse } from '../../src/shared/generated/AgentWorkspaceResponse'

import { MACHINE_PATHS } from '../../src/shared/agent-tools'
import { sessionTitleFrom } from '../../src/shared/session-title'
import { TOOL_TURN_HEADER } from '../../src/shared/agent-tools'
import { HttpError } from '../http'
import { identifier, invalidInput } from '../chat/inputs'
import { readJsonObject } from '../http/json-body'
import { requireCallingToolTurn } from './calling-turn'
import type { AgentToolServices } from './services'
import type { CallingWorkspace } from './store'
import { toolWorkspaceDetail } from './workspace-data'

const WORKSPACE_ROUTE = new RegExp(
  `^${MACHINE_PATHS.workspaces}/([^/]+)(?:/(rename|move|archive))?$`,
)

export function workspaceToolMethods(path: string): string[] | null {
  const match = path.match(WORKSPACE_ROUTE)
  return match ? [match[2] === undefined ? 'GET' : 'POST'] : null
}

function target(value: string, caller: CallingWorkspace): string {
  try {
    return value === 'current' ? caller.workspaceId : decodeURIComponent(value)
  } catch {
    throw new HttpError(
      404,
      'workspace_not_found',
      'The workspace is not available.',
    )
  }
}

export async function readWorkspaceFromTool(
  url: URL,
  db: D1Database,
  caller: CallingWorkspace,
  origin: string,
): Promise<AgentWorkspaceResponse | null> {
  const match = url.pathname.match(WORKSPACE_ROUTE)
  if (!match || match[2] !== undefined) return null
  return {
    workspace: await toolWorkspaceDetail(
      db,
      caller.orgId,
      target(match[1], caller),
      origin,
    ),
  }
}

export async function writeWorkspaceFromTool(
  request: Request,
  url: URL,
  db: D1Database,
  caller: CallingWorkspace,
  services: AgentToolServices,
  origin: string,
): Promise<Response | null> {
  const match = url.pathname.match(WORKSPACE_ROUTE)
  if (!match || !match[2]) return null
  const { sender } = await requireCallingToolTurn(
    db,
    caller,
    request.headers.get(TOOL_TURN_HEADER),
    services,
  )
  const workspaceId = target(match[1], caller)
  await toolWorkspaceDetail(db, caller.orgId, workspaceId, origin)
  const body: Record<string, unknown> =
    match[2] === 'archive' ? {} : await readJsonObject(request)
  const input =
    match[2] === 'rename'
      ? {
          kind: 'rename' as const,
          name: sessionTitleFrom(identifier(body.name)) ?? invalidInput(),
        }
      : match[2] === 'move'
        ? { kind: 'move' as const, sectionId: identifier(body.sectionId) }
        : { kind: 'archive' as const }
  await services.writeWorkspace({
    ...input,
    orgId: caller.orgId,
    workspaceId,
    senderUserId: sender.id,
  })
  return Response.json({
    workspace: await toolWorkspaceDetail(db, caller.orgId, workspaceId, origin),
  })
}
