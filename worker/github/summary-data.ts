import type { GitHubSummary } from '../../src/shared/generated/GitHubSummary'

import type { GitHubWorkspace } from './contracts'

export async function saveWorkspaceGitHubSummary(
  db: D1Database,
  workspace: GitHubWorkspace,
  summary: GitHubSummary | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE workspaces SET github_summary = ?
    WHERE id = ? AND org_id = ? AND branch = ? AND github_summary IS NOT ?`,
    )
    .bind(summary, workspace.id, workspace.orgId, workspace.branch, summary)
    .run()
}
