import {
  workspacePath,
  workspacePaths,
  workspacesPath,
} from '../../src/shared/workspaces'
import { orgSettingsPaths } from '../../src/shared/org-settings'
import type { AppDependencies, AppEnv } from '../env'
import { handleLifecycleRequest } from '../lifecycle/browser'
import { imageRuntime, workspaceRuntime } from '../lifecycle/runtime'
import { readWorkspace } from '../lifecycle/workspace-data'
import { requireFeatureResult } from '../features/result'
import type { RequestContext } from '../security/gate'
import { workspaceChildId } from './workspace-path'
import {
  requireWritableWorkspace,
  workspaceBinding,
  workspaceForViewer,
} from './workspace-state'

export async function chatLifecycleRoute(
  request: Request,
  env: AppEnv,
  context: RequestContext,
  dependencies: AppDependencies,
  execution?: Pick<ExecutionContext, 'waitUntil'>,
): Promise<Response | null> {
  if (!context.org) return null
  const orgId = context.org.id
  const path = new URL(request.url).pathname
  const workspaceId = workspaceChildId(path, orgId)
  const create = path === workspacesPath(orgId) && request.method === 'POST'
  const build =
    path === orgSettingsPaths.builds(orgId) ||
    path === orgSettingsPaths.refresh(orgId) ||
    path.startsWith(`${orgSettingsPaths.builds(orgId)}/`)
  const read =
    workspaceId &&
    path === workspacePath(orgId, workspaceId) &&
    request.method === 'GET'
  const action =
    workspaceId &&
    request.method === 'POST' &&
    [
      workspacePaths.resume(orgId, workspaceId),
      workspacePaths.activity(orgId, workspaceId),
    ].includes(path)
  if (!create && !read && !action && !build) return null
  if (action)
    requireWritableWorkspace(await readWorkspace(env.DB, orgId, workspaceId))
  const binding = workspaceBinding(env)
  const lifecycleEnv = { ...env, WORKSPACES: binding }
  if (
    workspaceId &&
    path === workspacePaths.resume(orgId, workspaceId) &&
    request.method === 'POST' &&
    requireFeatureResult(
      await binding
        .getByName(workspaceId)
        .resumeMemberCreation(orgId, workspaceId, context.user.id),
    )
  ) {
    const ordered = await binding
      .getByName(workspaceId, { locationHint: 'weur' })
      .readChatWorkspaceResponse(orgId, workspaceId, env.APP_ORIGIN)
    return Response.json({
      ...ordered.response,
      workspace: await workspaceForViewer(
        env,
        context.user.id,
        ordered.response.workspace,
        undefined,
        ordered.summary,
      ),
    })
  }
  return handleLifecycleRequest(
    request,
    context,
    {
      ...workspaceRuntime(lifecycleEnv, dependencies),
      images: imageRuntime(lifecycleEnv, dependencies),
    },
    {
      acceptFirstMessage: (first) =>
        binding
          .getByName(first.workspaceId, { locationHint: 'weur' })
          .acceptLifecycleFirstMessage(first),
      projectWorkspace: async (response) => {
        if (create)
          return {
            ...response,
            workspace: await workspaceForViewer(
              env,
              context.user.id,
              response.workspace,
            ),
          }
        const ordered = await binding
          .getByName(response.workspace.id, { locationHint: 'weur' })
          .readChatWorkspaceResponse(
            orgId,
            response.workspace.id,
            env.APP_ORIGIN,
          )
        return {
          ...ordered.response,
          workspace: await workspaceForViewer(
            env,
            context.user.id,
            ordered.response.workspace,
            undefined,
            ordered.summary,
          ),
        }
      },
      waitUntil: (promise) => execution?.waitUntil(promise),
    },
  )
}
