import { MACHINE_PATHS } from '../../src/shared/agent-tools'
import { TOOL_TURN_HEADER } from '../../src/shared/agent-tools'
import { requiredString, HttpError } from '../http'
import { readJsonObject } from '../http/json-body'
import { requireCallingToolTurn } from './calling-turn'
import type { CallingWorkspace } from './store'
import type { AgentToolServices } from './services'

const DELETE_SECTION = new RegExp(`^${MACHINE_PATHS.sections}/([^/]+)/delete$`)

export function sectionToolMethods(path: string): string[] | null {
  return path === MACHINE_PATHS.sections
    ? ['GET', 'POST']
    : DELETE_SECTION.test(path)
      ? ['POST']
      : null
}

export async function writeSectionFromTool(
  request: Request,
  url: URL,
  db: D1Database,
  caller: CallingWorkspace,
  services: AgentToolServices,
) {
  if (!sectionToolMethods(url.pathname)) return null
  const { sender } = await requireCallingToolTurn(
    db,
    caller,
    request.headers.get(TOOL_TURN_HEADER),
    services,
  )
  const context = { orgId: caller.orgId, senderUserId: sender.id }
  if (url.pathname === MACHINE_PATHS.sections) {
    const body = await readJsonObject(request)
    return Response.json(
      await services.writeSection({
        ...context,
        kind: 'create',
        name: requiredString(body.name),
      }),
      { status: 201 },
    )
  }
  const match = url.pathname.match(DELETE_SECTION)
  if (!match) return null
  let sectionId: string
  try {
    sectionId = decodeURIComponent(match[1])
  } catch {
    throw new HttpError(
      404,
      'section_not_found',
      'The section is not available.',
    )
  }
  return Response.json(
    await services.writeSection({ ...context, kind: 'delete', sectionId }),
  )
}
