import type { Workspace } from '../shared/generated/Workspace'
import type { WorkspaceStart } from '../shared/generated/WorkspaceStart'
import type { WorkspaceResponse } from '../shared/workspaces'

/**
 * The first start of a new workspace failed: the workspace shows the error
 * state, and its create start shows a failed step. The workspace stays with
 * its chat and its queued messages, so the composer stays under the bar,
 * and Try again starts a new cloud computer in the same workspace.
 *
 * A later error after a successful create keeps the completed create start,
 * which shows no failed step. A failed resume has a resume start. Both keep
 * the bar in place of the composer.
 */
export function failedFirstStart(
  workspace: Pick<Workspace, 'state'> | null,
  start: WorkspaceStart | null,
): boolean {
  return (
    workspace?.state === 'error' &&
    start?.kind === 'create' &&
    start.steps.some((step) => step.state === 'failed')
  )
}

/**
 * Whether an open resumes the sandbox: a stopped workspace, and one whose
 * later start failed. A failed first start waits for Try again, so that
 * each member and each return sees its saved cause first.
 */
export function resumesAtOpen(
  detail: Pick<WorkspaceResponse, 'workspace' | 'start'>,
): boolean {
  const { state } = detail.workspace
  if (state === 'stopped') return true
  return state === 'error' && !failedFirstStart(detail.workspace, detail.start)
}
