import type { AgentListSectionsResponse } from '../../src/shared/generated/AgentListSectionsResponse'
import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import type { MessageSender } from '../../src/shared/generated/MessageSender'

import { HttpError } from '../http'
import { workspaceTokenAccessPredicate } from '../data/workspace-token-access'
import { hash } from '../security/crypto'
import { choice, record, text } from './input'
import { messageSender } from './workspace-replies'
import {
  imageAdmissionError,
  readImageRepositories,
} from '../lifecycle/published-image-data'

export interface CallingWorkspace {
  workspaceId: string
  orgId: string
  ownerUserId: string
  repositoryId: string
}

export async function callingWorkspace(
  db: D1Database,
  token: string,
): Promise<CallingWorkspace | null> {
  const row = await db
    .prepare(
      `SELECT w.id AS workspaceId, w.org_id AS orgId,
       w.owner_user_id AS ownerUserId, w.repository_id AS repositoryId
       FROM workspace_tokens t
       JOIN workspaces w ON w.id = t.workspace_id
       JOIN org_members m ON m.org_id = w.org_id AND m.user_id = w.owner_user_id
       WHERE t.token_hash = ? AND ${workspaceTokenAccessPredicate}
       AND w.state != 'archived'`,
    )
    .bind(await hash(token))
    .first<unknown>()
  if (row === null) return null
  const fields = record(row)
  return {
    workspaceId: text(fields.workspaceId),
    orgId: text(fields.orgId),
    ownerUserId: text(fields.ownerUserId),
    repositoryId: text(fields.repositoryId),
  }
}

export async function orgSections(
  db: D1Database,
  orgId: string,
): Promise<AgentListSectionsResponse['sections']> {
  const { results } = await db
    .prepare(
      `SELECT id, name, is_default AS isDefault FROM sections
       WHERE org_id = ? ORDER BY position, id`,
    )
    .bind(orgId)
    .all<{ id: string; name: string; isDefault: number }>()
  return results.map((row) => ({
    id: row.id,
    name: row.name,
    default: row.isDefault === 1,
  }))
}

export async function memberSender(
  db: D1Database,
  orgId: string,
  userId: string,
): Promise<MessageSender | null> {
  const row = await db
    .prepare(
      `SELECT u.id, u.github_login AS githubLogin,
       u.display_name AS displayName, u.avatar_url AS avatarUrl
       FROM users u JOIN org_members m ON m.user_id = u.id
       WHERE m.org_id = ? AND u.id = ? AND u.suspended_at IS NULL`,
    )
    .bind(orgId, userId)
    .first<unknown>()
  return row === null ? null : messageSender(row)
}

export async function ownerPreference(
  db: D1Database,
  userId: string,
): Promise<AgentChoice | null> {
  const row = await db
    .prepare(
      `SELECT default_agent AS agent, default_model AS model,
       default_effort AS effort, default_fast AS fast FROM user_preferences
       WHERE user_id = ? AND default_agent IS NOT NULL`,
    )
    .bind(userId)
    .first<unknown>()
  return row === null
    ? null
    : choice({ ...record(row), fast: record(row).fast === 1 })
}

export async function creationSection(
  db: D1Database,
  orgId: string,
  sectionId: string | undefined,
): Promise<string> {
  const row = await db
    .prepare(
      sectionId === undefined
        ? 'SELECT id FROM sections WHERE org_id = ? AND is_default = 1'
        : 'SELECT id FROM sections WHERE org_id = ? AND id = ?',
    )
    .bind(...(sectionId === undefined ? [orgId] : [orgId, sectionId]))
    .first<unknown>()
  if (row === null) {
    throw new HttpError(
      404,
      'section_not_found',
      'The section is not available.',
    )
  }
  return text(record(row).id)
}

export async function requireRepository(
  db: D1Database,
  orgId: string,
  repositoryId: string,
): Promise<void> {
  const repositories = await readImageRepositories(db, orgId)
  if (!repositories.some((repository) => repository.id === repositoryId)) {
    throw await imageAdmissionError(
      db,
      orgId,
      'repository_not_found',
      repositoryId,
    )
  }
}
