import type { Timestamp } from './generated/Timestamp'
import { orgPath, type Org } from './api'

export interface OrgSummary extends Org {
  /** Custom initials shown in the rail. Older replies may omit them. */
  initials?: string
  suspension?: { suspendedAt: Timestamp }
  /** Absent for an active org. Only its admins can see a deleted org. */
  deletion?: { deletedAt: Timestamp; deletesAt: Timestamp }
}

export interface OrgsResponse {
  orgs: readonly OrgSummary[]
}
export interface MoveOrgRequest {
  orgId: string
  /** Zero-based index among the other visible orgs. */
  index: number
}

export function readMoveOrgRequest(value: unknown): MoveOrgRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null
  if (
    !('orgId' in value) ||
    typeof value.orgId !== 'string' ||
    !value.orgId.trim() ||
    !('index' in value) ||
    typeof value.index !== 'number' ||
    !Number.isInteger(value.index) ||
    value.index < 0
  )
    return null
  return { orgId: value.orgId.trim(), index: value.index }
}

export interface OrgResponse {
  org: OrgSummary
}
export interface CreateOrgRequest {
  name: string
  initials?: string
  /** GitHub repository IDs from the account list, not app Repository.id values. */
  repositoryIds?: readonly number[]
}
export type CreateOrgResponse = OrgResponse
export interface RenameOrgRequest {
  name: string
  initials?: string
}
export interface DeleteOrgRequest {
  name: string
}

export function deleteOrgPath(orgId: string): string {
  return `${orgPath(orgId)}/delete`
}
export function restoreOrgPath(orgId: string): string {
  return `${orgPath(orgId)}/restore`
}
export function leaveOrgPath(orgId: string): string {
  return `${orgPath(orgId)}/leave`
}
