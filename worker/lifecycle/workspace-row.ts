import type { Workspace } from '../../src/shared/generated/Workspace'
import type { WorkspaceState } from '../../src/shared/generated/WorkspaceState'

export interface WorkspaceRow {
  id: string
  number: number
  orgId: string
  repositoryId: string
  sectionId: string
  ownerUserId: string
  githubLogin: string
  displayName: string | null
  avatarUrl: string | null
  name: string | null
  branch: string
  baseBranch?: string | null
  sandboxId: string | null
  providerAccount: string
  state: WorkspaceState
  github: Workspace['github']
  createdAt: number
  updatedAt: number
  archivedAt: number | null
  stoppedAt: number | null
  nextDiskKeepaliveAt: number | null
  agent: Workspace['choice']['agent']
  model: string
  effort: Workspace['choice']['effort']
  fast: number
  sessionId: string
  firstTurnId: string
}
