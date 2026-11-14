import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import { requireActiveOrg } from '../data/user-access'
import type { User } from '../../src/shared/api'
import type { WorkspaceStartJob } from './start-types'
import { HttpError } from '../http'
import { leaseStatement, planStatement } from './creation-plan-statements'
import { readRepositories } from './settings-data'
import { capturedRepositoryLocations } from './repository-locations'
import { readSavedScript } from './saved-script'
import {
  imageAdmissionError,
  publishedImageSource,
  publishedRepositorySource,
  type ImageAdmissionFailure,
} from './published-image-data'

export interface CreationClaim {
  id: string
  state: 'pending' | 'succeeded'
}
export interface CreationKey {
  orgId: string
  senderUserId: string
  messageId: string
}

const completed = `SELECT r.workspace_id AS id, 'succeeded' AS state FROM workspace_runtime r
  JOIN workspaces w ON w.id = r.workspace_id
  WHERE r.org_id = ? AND r.created_by_user_id = ? AND r.first_message_id = ?`
const pending = `SELECT workspace_id AS id, 'pending' AS state FROM workspace_creation_attempts
  WHERE org_id = ? AND sender_user_id = ? AND first_message_id = ? AND state = 'pending'`

export function existingCreation(
  db: D1Database,
  key: CreationKey,
): Promise<CreationClaim | null> {
  return db
    .prepare(`${completed} UNION ALL ${pending} LIMIT 1`)
    .bind(
      key.orgId,
      key.senderUserId,
      key.messageId,
      key.orgId,
      key.senderUserId,
      key.messageId,
    )
    .first<CreationClaim>()
}

export async function claimCreation(
  db: D1Database,
  key: CreationKey,
  job: WorkspaceStartJob,
): Promise<CreationClaim> {
  const creation = job.creation
  if (!creation) throw new Error('Missing creation plan')
  const values = [key.orgId, key.senderUserId, key.messageId]
  const results = await db.batch<
    CreationClaim | { id: string; state: ImageAdmissionFailure }
  >([
    db
      .prepare(
        `INSERT OR IGNORE INTO workspace_creation_attempts
      (workspace_id, org_id, sender_user_id, first_message_id, created_at)
      SELECT ?, ?, ?, ?, ? ${publishedRepositorySource}
      AND NOT EXISTS (${completed})`,
      )
      .bind(
        job.workspaceId,
        ...values,
        creation.createdAt,
        job.orgId,
        job.providerAccount,
        creation.repositoryId,
        ...values,
      ),
    planStatement(db, job),
    leaseStatement(db, job.workspaceId),
    db
      .prepare(
        `${completed} UNION ALL ${pending}
        UNION ALL SELECT '' AS id, CASE WHEN EXISTS (
          SELECT 1 ${publishedImageSource} WHERE s.org_id = ? AND i.provider_account = ?
        ) THEN 'repository_not_found' ELSE 'image_required' END AS state LIMIT 1`,
      )
      .bind(...values, ...values, job.orgId, job.providerAccount),
  ])
  await requireActiveOrg(db, job.orgId)
  const claim = results[3].results[0]
  if (!claim) throw new Error('The creation claim could not be recorded')
  if (claim.state === 'pending' || claim.state === 'succeeded') return claim
  throw await imageAdmissionError(
    db,
    job.orgId,
    claim.state,
    creation.repositoryId,
  )
}

interface PlanRow {
  repositoryId: string
  ownerUserId: string
  sectionId: string | null
  sessionId: string
  turnId: string
  city: string
  name: string | null
  firstSessionTitle: string | null
  branch: string
  attempt: string
  startupScript: string
  environmentCiphertext: string | null
  imageName: string | null
  providerAccount: string
  defaultBranch: string
  baseBranch: string | null
  startSha: string | null
  repositoriesJson: string | null
  repositoryLocationsJson: string | null
  messageText: string | null
  agent: AgentChoice['agent']
  model: string
  effort: AgentChoice['effort']
  fast: number
  attachmentIds: string
  createdAt: number
}

export async function recordedCreationJob(
  db: D1Database,
  key: CreationKey,
  id: string,
  text: string,
): Promise<WorkspaceStartJob | null> {
  const plan = await db
    .prepare(
      `SELECT p.repository_id AS repositoryId, p.owner_user_id AS ownerUserId,
    p.section_id AS sectionId, p.session_id AS sessionId, p.turn_id AS turnId, p.city, p.name, p.first_session_title AS firstSessionTitle, p.branch,
    p.start_attempt AS attempt, p.startup_script AS startupScript, p.environment_ciphertext AS environmentCiphertext,
    p.image_name AS imageName, p.provider_account AS providerAccount,
    p.default_branch AS defaultBranch, p.base_branch AS baseBranch, p.start_sha AS startSha, p.agent, p.model, p.effort, p.fast,
    p.repositories_json AS repositoriesJson, p.repository_locations_json AS repositoryLocationsJson, p.message_text AS messageText,
    p.attachment_ids_json AS attachmentIds, a.created_at AS createdAt
    FROM workspace_creation_plans p JOIN workspace_creation_attempts a ON a.workspace_id = p.workspace_id
    WHERE p.workspace_id = ? AND a.org_id = ? AND a.sender_user_id = ? AND a.first_message_id = ?`,
    )
    .bind(id, key.orgId, key.senderUserId, key.messageId)
    .first<PlanRow>()
  if (!plan) return null
  const raw: unknown = JSON.parse(plan.attachmentIds)
  if (!Array.isArray(raw))
    throw new Error('Invalid creation attachment metadata')
  const attachmentIds = raw.map((value: unknown) => {
    if (typeof value !== 'string') throw new Error('Invalid attachment ID')
    return value
  })
  return {
    workspaceId: id,
    orgId: key.orgId,
    kind: 'create',
    imageName: plan.imageName,
    providerAccount: plan.providerAccount,
    startupScript: readSavedScript(plan.startupScript),
    environmentCiphertext: plan.environmentCiphertext,
    defaultBranch: plan.defaultBranch,
    baseBranch: plan.baseBranch ?? undefined,
    startSha: plan.startSha ?? undefined,
    repositoryLocations:
      plan.repositoriesJson === null
        ? undefined
        : capturedRepositoryLocations(
            plan.repositoryLocationsJson,
            readRepositories(JSON.parse(plan.repositoriesJson)),
          ),
    turnId: plan.turnId,
    attempt: plan.attempt,
    phase: 'records',
    processId: null,
    stdoutOffset: 0,
    stderrOffset: 0,
    creation: {
      user: await creationUser(db, plan.ownerUserId),
      sender: await creationUser(db, key.senderUserId),
      repositoryId: plan.repositoryId,
      sectionId: plan.sectionId ?? undefined,
      sessionId: plan.sessionId,
      firstSessionTitle: plan.firstSessionTitle ?? undefined,
      city: plan.city,
      ...(plan.name !== null && { name: plan.name }),
      branch: plan.branch,
      createdAt: plan.createdAt,
      request: {
        id: key.messageId,
        text: plan.messageText ?? text,
        attachmentIds,
        choice: {
          agent: plan.agent,
          model: plan.model,
          effort: plan.effort,
          fast: plan.fast === 1,
        },
      },
    },
  }
}

async function creationUser(db: D1Database, id: string): Promise<User> {
  const user = await db
    .prepare(
      'SELECT id, github_id AS githubId, github_login AS githubLogin, display_name AS displayName, avatar_url AS avatarUrl FROM users WHERE id = ?',
    )
    .bind(id)
    .first<User>()
  if (!user)
    throw new HttpError(
      404,
      'user_not_available',
      'The workspace sender is not available.',
    )
  return user
}

export async function repairCreationPlan(
  db: D1Database,
  job: WorkspaceStartJob,
): Promise<void> {
  const creation = job.creation
  if (!creation) throw new Error('Missing creation plan')
  await claimCreation(
    db,
    {
      orgId: job.orgId,
      senderUserId: creation.sender.id,
      messageId: creation.request.id,
    },
    job,
  )
}
