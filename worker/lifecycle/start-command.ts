import type { CommitAuthor } from '../../src/shared/generated/CommitAuthor'
import { shellQuote } from './commands'
import { defaultBranchCommand } from './default-branch-command'
import { repositoryLocation } from './repository-locations'
import type { StartupBootstrap } from './software-bootstrap'
import { workspaceStartupCommand } from './image-software'
import type { WorkspaceRow } from './workspace-row'
import type { WorkspaceStartJob } from './start-types'

/** Startup and repository commands share the same detached output journal. */
export function workspacePhaseCommand(
  row: WorkspaceRow,
  job: WorkspaceStartJob,
  owner: CommitAuthor | null,
  bootstrap?: StartupBootstrap,
): string {
  if (job.phase === 'startup')
    return workspaceStartupCommand(
      job.startupScript,
      owner,
      'workspace',
      bootstrap,
    )
  const directory = repositoryLocation(
    job.repositoryLocations,
    row.repositoryId,
  )
  if (job.phase === 'fetch') {
    if (!job.creation) throw new Error('Missing trusted creation sender')
    return defaultBranchCommand({
      directory,
      defaultBranch: job.baseBranch ?? job.defaultBranch,
      turnId: job.turnId,
      sender: job.creation.sender,
    })
  }
  const start = job.startSha
    ? `conductive_start=$(git rev-parse --verify --end-of-options ${shellQuote(`${job.startSha}^{commit}`)} 2>/dev/null) || conductive_start=FETCH_HEAD`
    : 'conductive_start=FETCH_HEAD'
  return `set -eu
export CONDUCTIVE_TURN_ID=${shellQuote(job.turnId)}
cd ${shellQuote(directory)}
${start}
if git show-ref --verify --quiet ${shellQuote(`refs/heads/${row.branch}`)}; then
  git checkout ${shellQuote(row.branch)}
else
  git checkout -b ${shellQuote(row.branch)} "$conductive_start"
fi
git config ${shellQuote(`branch.${row.branch}.gh-merge-base`)} ${shellQuote(job.baseBranch ?? job.defaultBranch)}`
}
