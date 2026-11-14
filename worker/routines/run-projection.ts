import type { WorkspaceState } from '../../src/shared/generated/WorkspaceState'
import type { RoutineRun } from '../../src/shared/routines'

import type { StoredRoutineRun } from './run-record-data'
import { readRunChoice, readRunTrigger } from './stored-run'

export interface RunProjectionRow extends Omit<
  RoutineRun,
  'trigger' | 'error' | 'state' | 'agent' | 'owner'
> {
  choiceJson: string | null
  ownerUserId: string | null
  githubLogin: string | null
  displayName: string | null
  avatarUrl: string | null
  triggerJson: string
  runState: StoredRoutineRun['state']
  workspaceState: WorkspaceState | null
  archivedAt: number | null
  errorCode: string | null
  errorMessage: string | null
  attemptState: string | null
  attemptErrorCode: string | null
  attemptErrorMessage: string | null
  workspaceErrorCode: string | null
  workspaceErrorMessage: string | null
}

export const runProjectionColumns = `r.id, r.routine_id AS routineId, r.org_id AS orgId,
  r.choice_json AS choiceJson, u.id AS ownerUserId, u.github_login AS githubLogin,
  u.display_name AS displayName, u.avatar_url AS avatarUrl,
  r.trigger_json AS triggerJson, r.state AS runState, w.id AS workspaceId,
  w.state AS workspaceState, w.archived_at AS archivedAt, r.error_code AS errorCode,
  r.error_message AS errorMessage, a.state AS attemptState, a.error_code AS attemptErrorCode,
  a.error_message AS attemptErrorMessage, w.last_error_code AS workspaceErrorCode,
  w.last_error_message AS workspaceErrorMessage, r.created_at AS createdAt,
  r.updated_at AS updatedAt`

export const runProjectionJoins = `LEFT JOIN users u ON u.id = r.owner_user_id
  LEFT JOIN workspace_creation_attempts a ON a.workspace_id = COALESCE(r.workspace_id,
    (SELECT workspace_id FROM workspace_creation_attempts WHERE org_id = r.org_id
      AND first_message_id = r.message_id AND (r.owner_user_id IS NULL OR sender_user_id = r.owner_user_id)
      ORDER BY created_at DESC, workspace_id DESC LIMIT 1))
  LEFT JOIN workspaces w ON w.id = COALESCE(r.workspace_id, a.workspace_id) AND w.org_id = r.org_id`

export function projectedRun(row: RunProjectionRow): RoutineRun {
  let state: RoutineRun['state']
  let error: RoutineRun['error'] = null
  if (row.runState === 'failed' || row.runState === 'skipped') {
    state = row.runState
    error =
      row.errorCode === null
        ? null
        : { code: row.errorCode, message: row.errorMessage ?? '' }
  } else if (row.workspaceId !== null) {
    state =
      row.archivedAt === null ? (row.workspaceState ?? 'starting') : 'archived'
    if (state === 'error' && row.workspaceErrorCode !== null)
      error = {
        code: row.workspaceErrorCode,
        message: row.workspaceErrorMessage ?? '',
      }
  } else if (row.attemptState === 'failed') {
    state = 'failed'
    error = {
      code: row.attemptErrorCode ?? 'workspace_start_failed',
      message:
        row.attemptErrorMessage ??
        'The cloud computer could not start. Try again.',
    }
  } else state = 'queued'
  return {
    id: row.id,
    routineId: row.routineId,
    orgId: row.orgId,
    agent: readRunChoice(row.choiceJson)?.agent ?? null,
    owner:
      row.ownerUserId === null || row.githubLogin === null
        ? null
        : {
            id: row.ownerUserId,
            githubLogin: row.githubLogin,
            displayName: row.displayName,
            avatarUrl: row.avatarUrl,
          },
    trigger: readRunTrigger(row.triggerJson),
    state,
    workspaceId: row.workspaceId,
    error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
