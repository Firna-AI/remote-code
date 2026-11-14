import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import type { Routine } from '../../src/shared/routines'
import { routineNotFound } from './errors'
import { readRoutineTriggers } from './stored-triggers'

interface RoutineRow
  extends
    Omit<Routine, 'owner' | 'choice' | 'triggers' | 'active'>,
    Omit<AgentChoice, 'fast'> {
  fast: number
  ownerUserId: string
  githubLogin: string
  displayName: string | null
  avatarUrl: string | null
  triggersJson: string
  active: number
}

const columns = `r.id, r.org_id AS orgId, r.owner_user_id AS ownerUserId,
  u.github_login AS githubLogin, u.display_name AS displayName, u.avatar_url AS avatarUrl,
  r.moved_from_name AS movedFrom, r.name, r.repository_id AS repositoryId,
  r.section_id AS sectionId, r.prompt, r.agent, r.model, r.effort, r.fast, r.active,
  r.inactive_reason AS inactiveReason, r.failed_runs_in_a_row AS failedRunsInARow,
  r.time_zone AS timeZone, r.triggers_json AS triggersJson, r.next_run_at AS nextRunAt,
  r.created_at AS createdAt, r.updated_at AS updatedAt`

function routine(row: RoutineRow): Routine {
  return {
    id: row.id,
    orgId: row.orgId,
    owner: {
      id: row.ownerUserId,
      githubLogin: row.githubLogin,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
    },
    movedFrom: row.movedFrom,
    name: row.name,
    repositoryId: row.repositoryId,
    sectionId: row.sectionId,
    prompt: row.prompt,
    choice: {
      agent: row.agent,
      model: row.model,
      effort: row.effort,
      fast: row.fast === 1,
    },
    active: row.active === 1,
    inactiveReason: row.inactiveReason,
    failedRunsInARow: row.failedRunsInARow,
    timeZone: row.timeZone,
    triggers: readRoutineTriggers(row.triggersJson),
    nextRunAt: row.nextRunAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function readRoutine(
  db: D1Database,
  orgId: string,
  id: string,
): Promise<Routine> {
  const row = await db
    .prepare(
      `SELECT ${columns} FROM routines r JOIN users u ON u.id = r.owner_user_id
    WHERE r.org_id = ? AND r.id = ?`,
    )
    .bind(orgId, id)
    .first<RoutineRow>()
  if (!row) throw routineNotFound()
  return routine(row)
}

export async function listRoutines(
  db: D1Database,
  orgId: string,
): Promise<Routine[]> {
  const { results } = await db
    .prepare(
      `SELECT ${columns} FROM routines r JOIN users u ON u.id = r.owner_user_id
    WHERE r.org_id = ? ORDER BY r.created_at DESC, r.id`,
    )
    .bind(orgId)
    .all<RoutineRow>()
  return results.map(routine)
}

export async function routineRepository(
  db: D1Database,
  orgId: string,
  repositoryId: string,
): Promise<boolean> {
  return (
    (await db
      .prepare(
        'SELECT id FROM repositories WHERE org_id = ? AND id = ? AND selected = 1',
      )
      .bind(orgId, repositoryId)
      .first()) !== null
  )
}

export async function routineSection(
  db: D1Database,
  orgId: string,
  id?: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT id FROM sections WHERE org_id = ? AND ${id === undefined ? 'is_default = 1' : 'id = ?'}`,
    )
    .bind(...(id === undefined ? [orgId] : [orgId, id]))
    .first<{ id: string }>()
  return row?.id ?? null
}
