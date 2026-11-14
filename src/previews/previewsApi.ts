import type { OpenPreviewRequest } from '../shared/generated/OpenPreviewRequest'
import type { Preview } from '../shared/generated/Preview'
import type { EmptyRequest } from '../shared/api'
import { previewPath, previewsPath } from '../shared/previews'
import {
  isRecord,
  requestJson,
  webUrl,
  type ToolResult,
} from '../terminal/tool-parts/request'
import type { ToolRequests } from '../terminal/tool-parts/workspace'

/** Narrows one preview, or gives null when a field is missing or wrong. */
function parsePreview(value: unknown): Preview | null {
  if (!isRecord(value)) return null
  const { id, port, expiresAt } = value
  const url = webUrl(value.url)
  if (typeof id !== 'string' || url === null) return null
  if (typeof port !== 'number' || typeof expiresAt !== 'number') return null
  return { id, port, url, expiresAt }
}

function parsePreviews(body: unknown): readonly Preview[] | null {
  if (!isRecord(body) || !Array.isArray(body.previews)) return null
  const previews = body.previews.map(parsePreview)
  return previews.every((preview) => preview !== null) ? previews : null
}

function parseOpened(body: unknown): Preview | null {
  return isRecord(body) ? parsePreview(body.preview) : null
}

/** Reads the open previews of the workspace. */
export function listPreviews(
  workspace: ToolRequests,
  signal: AbortSignal,
): Promise<ToolResult<readonly Preview[]>> {
  const path = previewsPath(workspace.orgId, workspace.workspaceId)
  return requestJson(
    workspace.fetch,
    { method: 'GET', path, signal },
    parsePreviews,
  )
}

/** Opens a preview of one port of the sandbox. */
export function openPreview(
  workspace: ToolRequests,
  port: number,
): Promise<ToolResult<Preview>> {
  const body: OpenPreviewRequest = { port }
  const path = previewsPath(workspace.orgId, workspace.workspaceId)
  return requestJson(
    workspace.fetch,
    { method: 'POST', path, body },
    parseOpened,
  )
}

/**
 * Closes a preview, so that its address stops working. The tool does not
 * abort it, so a close that the user started reaches the server.
 */
export function closePreview(
  workspace: ToolRequests,
  previewId: string,
): Promise<ToolResult<true>> {
  const body: EmptyRequest = {}
  const { orgId, workspaceId } = workspace
  return requestJson(
    workspace.fetch,
    {
      method: 'DELETE',
      path: previewPath(orgId, workspaceId, previewId),
      body,
    },
    () => true,
  )
}
