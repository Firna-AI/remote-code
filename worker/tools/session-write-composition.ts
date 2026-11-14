import type { AgentSessionResume } from '../../src/shared/generated/AgentSessionResume'
import type { AgentSessionWriteResponse } from '../../src/shared/generated/AgentSessionWriteResponse'

import { sessionLink } from '../../src/shared/session-link'
import { resumesAtOpen } from '../../src/app/first-start'
import { HttpError } from '../http'
import type { AppDependencies, AppEnv } from '../env'
import { workspaceBinding } from '../app-api/workspace-state'
import { requireFeatureResult } from '../features/result'
import { workspaceRuntime } from '../lifecycle/runtime'
import { workspaceResponse } from '../lifecycle/workspace-response'
import { resumeWorkspace } from '../lifecycle/workspace-resume'
import type { ToolSessionWrite } from './services'
import { toolSessionWorkspace } from './session-access'

export async function writeSessionFromTool(
  env: AppEnv,
  dependencies: AppDependencies,
  input: ToolSessionWrite,
): Promise<AgentSessionWriteResponse> {
  const admitted = requireFeatureResult(
    await workspaceBinding(env)
      .getByName(input.workspaceId)
      .writeAgentSession(input),
  )
  const { workspace: snapshot, ...accepted } = admitted
  let workspace = snapshot
  let resume: AgentSessionResume = { state: 'not_needed', error: null }
  if (accepted.message) {
    try {
      workspace = await toolSessionWorkspace(
        env.DB,
        input.orgId,
        input.workspaceId,
        env.APP_ORIGIN,
      )
      const runtime = workspaceRuntime(env, dependencies)
      const detail = await workspaceResponse(
        runtime,
        input.orgId,
        input.workspaceId,
      )
      if (resumesAtOpen(detail)) {
        const resuming = await resumeWorkspace(
          runtime,
          input.orgId,
          input.workspaceId,
          input.senderUserId,
        )
        workspace = { ...workspace, state: resuming.workspace.state }
        resume =
          resuming.workspace.state === 'stopped' ||
          resuming.workspace.state === 'error'
            ? resuming.error
              ? {
                  state: 'failed',
                  error: {
                    code: resuming.error.code,
                    message: resuming.error.message,
                  },
                }
              : { state: 'waiting', error: null }
            : { state: 'queued', error: null }
      } else if (detail.workspace.state === 'error') {
        resume = { state: 'waiting', error: null }
      }
    } catch (error) {
      if (!(error instanceof HttpError)) throw error
      resume = {
        state: 'failed',
        error: { code: error.code, message: error.message },
      }
    }
  }
  return {
    ...accepted,
    workspace,
    session: {
      ...accepted.session,
      link: sessionLink(
        env.APP_ORIGIN,
        input.orgId,
        input.workspaceId,
        accepted.session.id,
      ),
    },
    resume,
  }
}
