import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import type { AppDependencies, AppEnv } from '../env'
import { HttpError } from '../http'
import { updateWorkspaceTitle } from '../chat/queries'
import { canFillWorkspaceTitle } from '../chat/workspace-title'
import type { DurableLifecycleState, LifecyclePublisher } from './durable-types'
import type {
  LifecyclePublication,
  WorkspaceEventJournal,
} from './durable-journal'
import {
  persistLifecycleState,
  readWorkspace,
  workspaceRecord,
} from './workspace-data'

interface ProjectionOptions {
  env: AppEnv
  dependencies: AppDependencies
  journal: WorkspaceEventJournal
  readLifecycle(): Promise<DurableLifecycleState | undefined>
  deviceWaiting(workspaceId: string): Promise<boolean>
  latestTitle(
    workspaceId: string,
  ): Promise<{ name: string; occurredAt: number } | null>
}

type ProjectionWrite =
  { response: LifecyclePublication } | { titleError: unknown } | undefined

/** Both callers already own the workspace chat queue. This class adds no queue. */
export class WorkspaceStateProjection {
  private readonly options: ProjectionOptions
  constructor(options: ProjectionOptions) {
    this.options = options
  }

  private async write(
    now: number,
    workspaceId?: string,
  ): Promise<ProjectionWrite> {
    const { env, readLifecycle, deviceWaiting } = this.options
    const current = await readLifecycle()
    if (!current) return undefined
    if (workspaceId !== undefined && current.workspaceId !== workspaceId)
      throw new HttpError(
        404,
        'workspace_not_found',
        'The workspace is not available.',
      )
    const waiting = await deviceWaiting(current.workspaceId)
    const state =
      waiting && !['stopped', 'error', 'archived'].includes(current.state)
        ? 'input'
        : current.state
    const before = await readWorkspace(
      env.DB,
      current.orgId,
      current.workspaceId,
    )
    const updatedAt = Math.max(
      now,
      this.options.dependencies.now(),
      before.updatedAt,
    )
    const title = await this.options.latestTitle(current.workspaceId)
    if (title && canFillWorkspaceTitle(before)) {
      try {
        await updateWorkspaceTitle(
          env.DB,
          current.workspaceId,
          title.name,
          updatedAt,
        )
      } catch (titleError) {
        return { titleError }
      }
    }
    await persistLifecycleState(env.DB, { ...current, state }, updatedAt)
    const row = await readWorkspace(env.DB, current.orgId, current.workspaceId)
    return {
      response: {
        workspace: workspaceRecord(row),
        start: current.start,
        error: current.error,
      },
    }
  }

  async changed(publish?: LifecyclePublisher): Promise<boolean> {
    const now = this.options.dependencies.now()
    const result = await this.write(now)
    if (result && 'titleError' in result) {
      if (!publish) throw result.titleError
      return false
    }
    if (result && 'response' in result)
      await this.options.journal.publishLifecycle(result.response, now, publish)
    return true
  }

  async deviceChanged(
    workspaceId: string,
    choice: AgentChoice | undefined,
    now: number,
    publish: LifecyclePublisher,
  ): Promise<boolean> {
    const result = await this.write(now, workspaceId)
    if (!result) return false
    if ('titleError' in result) throw result.titleError
    const { response } = result
    await publish({
      workspaceId,
      occurredAt: now,
      event: {
        type: 'workspace.updated',
        workspace: {
          ...response.workspace,
          choice: choice ?? response.workspace.choice,
        },
      },
    })
    return true
  }
}
