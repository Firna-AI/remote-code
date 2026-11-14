import type { CommitAuthor } from '../../src/shared/generated/CommitAuthor'
import {
  COMMIT_AUTHOR_VARIABLES,
  commitAuthor,
} from '../../src/shared/commit-author'
import { TOOL_ENV } from '../../src/shared/agent-tools'
import { readUser } from '../data/users'
import type { AppEnv } from '../env'
import { environmentValues, type OrgEnvironment } from './org-environment'
import {
  repositoryEnvironment,
  repositoryLocation,
  type RepositoryLocation,
} from './repository-locations'
import { readWorkspaceToken } from './tokens'
import type { WorkspaceRow } from './workspace-row'

/**
 * The runner gives each agent process the turn ID and the turn's author. A
 * shell can load the sandbox variables again, as a login shell does. So the
 * sandbox variables never hold these names, also when the org sets one.
 */
const TURN_VARIABLES: ReadonlySet<string> = new Set([
  TOOL_ENV.turnId,
  ...COMMIT_AUTHOR_VARIABLES,
])

export async function sandboxEnvironment(
  env: AppEnv,
  input: {
    workspace: WorkspaceRow
    environment: OrgEnvironment
    locations: readonly RepositoryLocation[]
    defaultBranch: string
    diskKeepalive: boolean
  },
): Promise<Record<string, string>> {
  const { workspace, environment, locations } = input
  const token = await readWorkspaceToken(env, workspace.id)
  return {
    ...Object.fromEntries(
      Object.entries(environmentValues(environment)).filter(
        ([name]) => !TURN_VARIABLES.has(name),
      ),
    ),
    ...repositoryEnvironment(locations),
    WORKSPACE_TOKEN: token,
    CONDUCTIVE_WORKSPACE_ID: workspace.id,
    CONDUCTIVE_MACHINE_ORIGIN: env.MACHINE_ORIGIN ?? '',
    CONDUCTIVE_DEFAULT_BRANCH: input.defaultBranch,
    CONDUCTIVE_WORKSPACE_BRANCH: workspace.branch,
    CONDUCTIVE_REPOSITORY_DIR: repositoryLocation(
      locations,
      workspace.repositoryId,
    ),
    CONDUCTIVE_DISK_KEEPALIVE: input.diskKeepalive ? '1' : '0',
  }
}

/** Git uses this author outside an agent turn. The start checks report a missing owner. */
export async function ownerCommitAuthor(
  db: D1Database,
  ownerUserId: string,
): Promise<CommitAuthor | null> {
  const owner = await readUser(db, ownerUserId)
  return owner ? commitAuthor(owner) : null
}
