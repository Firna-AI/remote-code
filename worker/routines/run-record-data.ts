import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import type { RoutineRunTrigger } from '../../src/shared/routines'
import type { AppDependencies } from '../env'
import { readRunChoice, readRunTrigger } from './stored-run'
import { pullRequestLoopGuard } from './pull-request-data'

export interface StoredRoutineRun {
  id: string
  routineId: string
  orgId: string
  ownerUserId: string | null
  choice: AgentChoice | null
  messageId: string
  trigger: RoutineRunTrigger
  state: 'queued' | 'started' | 'finished' | 'failed' | 'skipped'
  workspaceId: string | null
}

export async function storedRoutineRun(
  db: D1Database,
  orgId: string,
  id: string,
): Promise<StoredRoutineRun | null> {
  const row = await db
    .prepare(
      `SELECT id, routine_id AS routineId, org_id AS orgId,
    owner_user_id AS ownerUserId, message_id AS messageId, trigger_json AS triggerJson,
    state, workspace_id AS workspaceId, choice_json AS choiceJson
    FROM routine_runs WHERE org_id = ? AND id = ?`,
    )
    .bind(orgId, id)
    .first<
      Omit<StoredRoutineRun, 'trigger' | 'choice'> & {
        triggerJson: string
        choiceJson: string | null
      }
    >()
  return row
    ? {
        ...row,
        trigger: readRunTrigger(row.triggerJson),
        choice: readRunChoice(row.choiceJson),
      }
    : null
}

export async function recordRoutineRun(
  db: D1Database,
  input: {
    orgId: string
    routineId: string
    runKey: string
    trigger: RoutineRunTrigger
    ownerId?: string
    triggersJson?: string
    senderGitHubId?: number
    skip?: { code: string; message: string }
  },
  dependencies: Pick<AppDependencies, 'now' | 'randomToken'>,
): Promise<string | null> {
  const now = dependencies.now()
  const pullRequest =
    input.trigger.kind === 'pull-request' ? input.trigger : null
  await db
    .prepare(
      `INSERT OR IGNORE INTO routine_runs
    (id, routine_id, org_id, owner_user_id, run_key, message_id, trigger_json, state, error_code, error_message, created_at, updated_at)
    SELECT ?, r.id, r.org_id, r.owner_user_id, ?, ?, ?, ?, ?, ?, ?, ? FROM routines r
    WHERE r.org_id = ? AND r.id = ? AND (? = 1 OR r.active = 1)
      AND (? IS NULL OR r.owner_user_id = ?)
      AND (? IS NULL OR r.triggers_json = ?)
      AND EXISTS (SELECT 1 FROM orgs o JOIN users u ON u.id = r.owner_user_id
        JOIN org_members m ON m.org_id = o.id AND m.user_id = u.id
        WHERE o.id = r.org_id AND o.deleted_at IS NULL AND o.suspended_at IS NULL
          AND u.suspended_at IS NULL)
      ${pullRequestLoopGuard}`,
    )
    .bind(
      dependencies.randomToken(),
      input.runKey,
      dependencies.randomToken(),
      JSON.stringify(input.trigger),
      input.skip ? 'skipped' : 'queued',
      input.skip?.code ?? null,
      input.skip?.message ?? null,
      now,
      now,
      input.orgId,
      input.routineId,
      input.trigger.kind === 'run-now' ? 1 : 0,
      input.ownerId ?? null,
      input.ownerId ?? null,
      input.triggersJson ?? null,
      input.triggersJson ?? null,
      pullRequest && input.senderGitHubId !== undefined ? 1 : 0,
      pullRequest?.headBranch ?? null,
      input.senderGitHubId ?? null,
      pullRequest?.number ?? null,
    )
    .run()
  const row = await db
    .prepare(
      'SELECT id FROM routine_runs WHERE run_key = ? AND org_id = ? AND routine_id = ?',
    )
    .bind(input.runKey, input.orgId, input.routineId)
    .first<{ id: string }>()
  return row?.id ?? null
}

export async function attachRunWorkspace(
  db: D1Database,
  orgId: string,
  id: string,
  workspaceId: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE routine_runs SET workspace_id = ?, state = 'started', updated_at = ?
    WHERE org_id = ? AND id = ? AND state = 'queued'`,
    )
    .bind(workspaceId, now, orgId, id)
    .run()
}

export async function skipRoutineRun(
  db: D1Database,
  orgId: string,
  id: string,
  reason: { code: string; message: string },
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE routine_runs SET state = 'skipped', error_code = ?, error_message = ?, updated_at = ?
    WHERE org_id = ? AND id = ? AND state = 'queued'`,
    )
    .bind(reason.code, reason.message, now, orgId, id)
    .run()
}
