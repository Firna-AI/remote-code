import type { Timestamp } from './generated/Timestamp'
import { orgPath } from './api'
import type { BaseImage } from './base-image'

export const orgSettingsPaths = {
  repositories: (orgId: string) => `${orgPath(orgId)}/repositories`,
  settings: (orgId: string) => `${orgPath(orgId)}/settings`,
  builds: (orgId: string) => `${orgPath(orgId)}/builds`,
  refresh: (orgId: string) => `${orgPath(orgId)}/image/refresh`,
} as const

export function repositoryPath(orgId: string, repositoryId: string): string {
  return `${orgSettingsPaths.repositories(orgId)}/${encodeURIComponent(repositoryId)}`
}

export function buildPath(orgId: string, buildId: string): string {
  return `${orgSettingsPaths.builds(orgId)}/${encodeURIComponent(buildId)}`
}
export function buildEventsPath(orgId: string, buildId: string): string {
  return `${buildPath(orgId, buildId)}/events`
}

export interface Repository {
  id: string
  orgId: string
  githubId: number
  fullName: string
  description: string
  defaultBranch: string
  installationId: number
  selected: boolean
}
export interface RepositoriesResponse {
  repositories: readonly Repository[]
}

export interface OrgSettings {
  /** Software included before the install script. Older replies may omit it. */
  baseImage?: BaseImage
  installScript: string
  startupScript: string
  /** A stored value never goes back to the browser. */
  envVars: readonly { name: string; secret: boolean }[]
  updatedAt: Timestamp
}
export interface OrgSettingsResponse {
  settings: OrgSettings
}
export interface UpdateOrgSettingsRequest {
  installScript?: string
  startupScript?: string
  envVars?: readonly (
    | { operation: 'set'; name: string; value: string; secret?: boolean }
    | { operation: 'classify'; name: string; secret: boolean }
    | { operation: 'remove'; name: string }
  )[]
}

export interface ImageBuild {
  id: string
  orgId: string
  kind: 'build' | 'refresh'
  state: 'running' | 'succeeded' | 'failed'
  startedAt: Timestamp
  completedAt: Timestamp | null
  durationMs: number | null
  error: string | null
}
export interface BuildLogEvent {
  eventNumber: number
  occurredAt: Timestamp
  text: string
}
export interface BuildsResponse {
  builds: readonly ImageBuild[]
  currentImageBuildId: string | null
  changes: {
    installScript: boolean
    addedRepositories: readonly { id: string; fullName: string }[]
    removedRepositories: readonly { id: string; fullName: string }[]
  }
}
export interface BuildResponse {
  build: ImageBuild
  log: readonly BuildLogEvent[]
}
