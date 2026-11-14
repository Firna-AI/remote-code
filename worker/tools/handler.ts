import type { AgentCreateWorkspaceRequest } from '../../src/shared/generated/AgentCreateWorkspaceRequest'
import { MACHINE_PATHS, TOOL_TURN_HEADER } from '../../src/shared/agent-tools'
import { errorResponse, HttpError, privateResponse } from '../http'
import { readJsonObject } from '../http/json-body'
import {
  workspaceToolMethods,
  readWorkspaceFromTool,
  writeWorkspaceFromTool,
} from './workspace-routes'
import { sectionToolMethods, writeSectionFromTool } from './section-routes'
import {
  previewToolMethods,
  readPreviewsFromTool,
  writePreviewFromTool,
} from './preview-routes'
import { createFromTool } from './create'
import { createWorkspaceInput, ToolInputError } from './input'
import { createdWorkspace } from './workspace-replies'
import { isAgentToolPath, listFromTool } from './lists'
import type { AgentToolServices } from './services'
import { callingWorkspace } from './store'
import {
  readSessionsFromTool,
  sessionToolMethods,
  writeSessionsFromTool,
} from './session-routes'

export interface AgentToolsEnvironment {
  DB: D1Database
  MACHINE_ORIGIN: string
  APP_ORIGIN: string
}

/** Mount only on the machine surface. This handler authorizes no other route. */
export function createAgentToolsHandler(
  env: AgentToolsEnvironment,
  services: AgentToolServices,
) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url)
      if (url.origin !== env.MACHINE_ORIGIN || !isAgentToolPath(url.pathname)) {
        throw new HttpError(404, 'not_found', 'The page is not available.')
      }
      const methods =
        sectionToolMethods(url.pathname) ??
        previewToolMethods(url.pathname) ??
        workspaceToolMethods(url.pathname) ??
        sessionToolMethods(url.pathname) ??
        (url.pathname === MACHINE_PATHS.workspaces ? ['GET', 'POST'] : ['GET'])
      const allow = methods.join(', ')
      if (!methods.includes(request.method) || request.headers.has('Upgrade')) {
        return privateResponse(
          Response.json(
            {
              error: {
                code: 'method_not_allowed',
                message: `Use ${methods.join(' or ')}.`,
              },
            },
            { status: 405, headers: { Allow: allow } },
          ),
        )
      }
      const authorization = request.headers.get('Authorization')
      const bearer = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1]
      const caller = bearer ? await callingWorkspace(env.DB, bearer) : null
      if (!caller) {
        throw new HttpError(
          401,
          'workspace_token_invalid',
          'The workspace login is not valid. Start the workspace again.',
        )
      }
      if (request.method === 'GET') {
        const previews = await readPreviewsFromTool(
          url,
          env.DB,
          caller,
          services,
          env.APP_ORIGIN,
        )
        if (previews !== null) return privateResponse(Response.json(previews))
        const workspace = await readWorkspaceFromTool(
          url,
          env.DB,
          caller,
          env.APP_ORIGIN,
        )
        if (workspace) return privateResponse(Response.json(workspace))
        const sessions = await readSessionsFromTool(
          url,
          env.DB,
          caller,
          env.APP_ORIGIN,
          services,
        )
        if (sessions !== null) return privateResponse(Response.json(sessions))
        return privateResponse(
          Response.json(
            await listFromTool(url, env.DB, caller, services, env.APP_ORIGIN),
          ),
        )
      }
      const section = await writeSectionFromTool(
        request,
        url,
        env.DB,
        caller,
        services,
      )
      if (section) return privateResponse(section)
      const preview = await writePreviewFromTool(
        request,
        url,
        env.DB,
        caller,
        services,
        env.APP_ORIGIN,
      )
      if (preview) return privateResponse(preview)
      const workspace = await writeWorkspaceFromTool(
        request,
        url,
        env.DB,
        caller,
        services,
        env.APP_ORIGIN,
      )
      if (workspace) return privateResponse(workspace)
      const written = await writeSessionsFromTool(
        request,
        url,
        env.DB,
        caller,
        services,
      )
      if (written) return privateResponse(written)
      let input: AgentCreateWorkspaceRequest
      try {
        input = createWorkspaceInput(await readJsonObject(request))
      } catch (error) {
        if (error instanceof HttpError && error.code === 'json_required')
          throw error
        throw new HttpError(
          400,
          'invalid_input',
          error instanceof ToolInputError
            ? error.message
            : 'Send valid JSON for the workspace request.',
        )
      }
      const result = await createFromTool(
        env.DB,
        caller,
        request.headers.get(TOOL_TURN_HEADER),
        input,
        services,
        env.APP_ORIGIN,
      )
      return privateResponse(
        Response.json(createdWorkspace(result), { status: 201 }),
      )
    } catch (error) {
      return privateResponse(errorResponse(error))
    }
  }
}
