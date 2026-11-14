import type { Timestamp } from './generated/Timestamp'
import { workspacePath } from './workspaces'

export function desktopPath(orgId: string, workspaceId: string): string {
  return `${workspacePath(orgId, workspaceId)}/desktop`
}

/** GET obtains a new URL on each page load. Its token stays in the fragment. */
export interface DesktopResponse {
  url: string
  expiresAt: Timestamp
}
