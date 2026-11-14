import { MACHINE_PATHS } from '../../src/shared/agent-tools'
import { TOOL_TURN_HEADER } from '../../src/shared/agent-tools'
import { HttpError } from '../http'
import { readJsonObject } from '../http/json-body'
import { requireCallingToolTurn } from './calling-turn'
import { toolSessionWorkspace } from './session-access'
import type { CallingWorkspace } from './store'
import type { AgentToolServices } from './services'

const PREVIEW_ROUTE = new RegExp(
  `^${MACHINE_PATHS.workspaces}/([^/]+)/previews(?:/([^/]+)/close)?$`,
)

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

function target(value: string, caller: CallingWorkspace): string {
  return value === 'current' ? caller.workspaceId : decode(value)
}

export function previewToolMethods(path: string): string[] | null {
  const match = path.match(PREVIEW_ROUTE)
  return !match ? null : match[2] ? ['POST'] : ['GET', 'POST']
}

export async function readPreviewsFromTool(
  url: URL,
  db: D1Database,
  caller: CallingWorkspace,
  services: AgentToolServices,
  origin: string,
) {
  const match = url.pathname.match(PREVIEW_ROUTE)
  if (!match || match[2]) return null
  const workspaceId = target(match[1], caller)
  await toolSessionWorkspace(db, caller.orgId, workspaceId, origin)
  return services.previewCall({
    kind: 'list',
    orgId: caller.orgId,
    workspaceId,
  })
}

export async function writePreviewFromTool(
  request: Request,
  url: URL,
  db: D1Database,
  caller: CallingWorkspace,
  services: AgentToolServices,
  origin: string,
) {
  const match = url.pathname.match(PREVIEW_ROUTE)
  if (!match) return null
  const { sender } = await requireCallingToolTurn(
    db,
    caller,
    request.headers.get(TOOL_TURN_HEADER),
    services,
  )
  const workspaceId = target(match[1], caller)
  await toolSessionWorkspace(db, caller.orgId, workspaceId, origin)
  const context = { orgId: caller.orgId, workspaceId, senderUserId: sender.id }
  if (!match[2]) {
    const body = await readJsonObject(request)
    return Response.json(
      await services.previewCall({ ...context, kind: 'open', port: body.port }),
      { status: 201 },
    )
  }
  return Response.json(
    await services.previewCall({
      ...context,
      kind: 'close',
      previewId: decode(match[2]),
    }),
  )
}
