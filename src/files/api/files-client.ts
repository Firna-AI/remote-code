import type { ChangesResponse } from '../../shared/generated/ChangesResponse'
import type { DiffResponse } from '../../shared/generated/DiffResponse'
import type { FileResponse } from '../../shared/generated/FileResponse'
import type { FileTreeResponse } from '../../shared/generated/FileTreeResponse'
import { filePaths } from '../../shared/files'
import {
  errorFromBody,
  errorFromThrown,
  failure,
  type FilesResult,
} from './files-errors'
import {
  parseChanges,
  parseDiffResponse,
  parseFileResponse,
} from './parse-changes'
import { parseFileTree } from './parse-tree'

/** The fetch of the browser, or a fake with the same shape. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** The file reads and the download address of one workspace. No method throws. */
export interface FilesClient {
  readTree(signal?: AbortSignal): Promise<FilesResult<FileTreeResponse>>
  readChanges(signal?: AbortSignal): Promise<FilesResult<ChangesResponse>>
  readFile(
    path: string,
    signal?: AbortSignal,
  ): Promise<FilesResult<FileResponse>>
  readDiff(
    path: string,
    signal?: AbortSignal,
  ): Promise<FilesResult<DiffResponse>>
  /**
   * The address of the download route of one file. Download reads it with
   * the session cookie, and saves the file only when the route sends it.
   */
  downloadHref(path: string): string
}

export interface FilesClientOptions {
  fetch: FetchLike
  orgId: string
  workspaceId: string
}

async function send(
  fetch: FetchLike,
  path: string,
  signal: AbortSignal | undefined,
): Promise<FilesResult<Response>> {
  try {
    const response = await fetch(path, {
      headers: { Accept: 'application/json' },
      signal,
    })
    if (response.ok) return { ok: true, value: response }
    const body: unknown = await response.json().catch(() => null)
    return failure(errorFromBody(response.status, body))
  } catch (thrown) {
    return failure(errorFromThrown(thrown))
  }
}

async function readJson<T>(
  fetch: FetchLike,
  path: string,
  parse: (value: unknown) => T | null,
  signal: AbortSignal | undefined,
): Promise<FilesResult<T>> {
  const sent = await send(fetch, path, signal)
  if (!sent.ok) return sent
  try {
    const body: unknown = await sent.value.json()
    const value = parse(body)
    if (value !== null) return { ok: true, value }
    return failure({ kind: 'failed', status: 200, code: 'invalid_response' })
  } catch (thrown) {
    const error = errorFromThrown(thrown)
    if (error.kind === 'aborted') return failure(error)
    return failure({ kind: 'failed', status: 200, code: 'invalid_response' })
  }
}

/** The client of the file routes, with the fetch that the shell injects. */
export function createFilesClient(options: FilesClientOptions): FilesClient {
  const { fetch, orgId, workspaceId } = options
  return {
    readTree: (signal) =>
      readJson(
        fetch,
        filePaths.tree(orgId, workspaceId),
        parseFileTree,
        signal,
      ),
    readChanges: (signal) =>
      readJson(
        fetch,
        filePaths.changes(orgId, workspaceId),
        parseChanges,
        signal,
      ),
    readFile: (path, signal) =>
      readJson(
        fetch,
        filePaths.content(orgId, workspaceId, path),
        parseFileResponse,
        signal,
      ),
    readDiff: (path, signal) =>
      readJson(
        fetch,
        filePaths.diff(orgId, workspaceId, path),
        parseDiffResponse,
        signal,
      ),
    downloadHref: (path) => filePaths.download(orgId, workspaceId, path),
  }
}
