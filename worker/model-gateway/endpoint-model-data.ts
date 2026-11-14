import type { Agent } from '../../src/shared/generated/Agent'
export interface EndpointModelRead {
  userId: string
  agent: Agent
  ciphertext: string
  attemptId: string
}

/** Claim in D1 before fetching, including attempts whose fetch later fails. */
export async function claimEndpointModelRead(
  db: D1Database,
  userId: string,
  agent: Agent,
  now: number,
  background: boolean,
  ciphertext?: string,
): Promise<EndpointModelRead | null> {
  const attemptId = crypto.randomUUID()
  const row = await db
    .prepare(
      `UPDATE agent_logins SET endpoint_models_attempted_at = ?,
       endpoint_models_attempt_id = ? WHERE user_id = ? AND agent = ? AND kind = 'endpoint'
       AND (? IS NULL OR ciphertext = ?)
       AND (? = 0 OR endpoint_models_attempted_at IS NULL OR endpoint_models_attempted_at <= ?)
       RETURNING ciphertext`,
    )
    .bind(
      now,
      attemptId,
      userId,
      agent,
      ciphertext ?? null,
      ciphertext ?? null,
      background ? 1 : 0,
      now - 600_000,
    )
    .first<{ ciphertext: string }>()
  return row ? { userId, agent, ciphertext: row.ciphertext, attemptId } : null
}

export async function saveEndpointModels(
  db: D1Database,
  read: EndpointModelRead,
  ids: readonly string[],
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE agent_logins SET endpoint_model_ids = ?, endpoint_models_read_at = ?
       WHERE user_id = ? AND agent = ? AND kind = 'endpoint'
       AND ciphertext = ? AND endpoint_models_attempt_id = ?`,
    )
    .bind(
      JSON.stringify(ids),
      now,
      read.userId,
      read.agent,
      read.ciphertext,
      read.attemptId,
    )
    .run()
}
