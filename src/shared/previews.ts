import type { Preview } from './generated/Preview'
import type { Timestamp } from './generated/Timestamp'
import { workspacePath } from './workspaces'

export const PREVIEW_RELAY_PORT = 7682
export const PREVIEW_RELAY_PORT_HEADER = 'X-Conductive-Preview-Port'
export const PREVIEW_RELAY_MARK_HEADER = 'X-Conductive-Relay'

export function previewsPath(orgId: string, workspaceId: string): string {
  return `${workspacePath(orgId, workspaceId)}/previews`
}
export function previewPath(
  orgId: string,
  workspaceId: string,
  previewId: string,
): string {
  return `${previewsPath(orgId, workspaceId)}/${encodeURIComponent(previewId)}`
}
export interface PreviewResponse {
  preview: Preview
}
export interface PreviewsResponse {
  previews: readonly Preview[]
}

/** Native-only launcher reply. The short preview grant appears only in the URL fragment. */
export interface PreviewLaunchResponse {
  url: string
  expiresAt: Timestamp
}
