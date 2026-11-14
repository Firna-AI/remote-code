import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import { readRunChoice } from './stored-run'

export async function recordRunChoice(
  db: D1Database,
  orgId: string,
  runId: string,
  choice: AgentChoice,
): Promise<AgentChoice> {
  const row = await db
    .prepare(
      `UPDATE routine_runs SET choice_json = COALESCE(choice_json, ?)
    WHERE org_id = ? AND id = ? RETURNING choice_json AS choiceJson`,
    )
    .bind(JSON.stringify(choice), orgId, runId)
    .first<{ choiceJson: string }>()
  const recorded = row && readRunChoice(row.choiceJson)
  if (!recorded) throw new Error('The routine run choice was not saved.')
  return recorded
}
