import type { FileResponse } from '../../src/shared/generated/FileResponse'
import { decodeUtf8 } from '../../src/shared/utf8'
import type { AppEnv, HttpFetch } from '../env'
import { HttpError } from '../http'
import { ProviderError } from '../sandbox/errors'
import { orgProviderForAccount } from '../sandbox/client'
import type { SandboxFileRead } from '../sandbox/provider'
import type { FilesWorkspace } from './data'
import { fileBytes, parseFile } from './content'
import {
  FileTooLargeError,
  fileUnavailable,
  invalidFileResponse,
} from './errors'
import { checkByteLimit, readFilePath } from './paths'

/** Fixed Boat file route. The handler supplies the authorized D1 workspace. */
export async function readBoatFile(
  env: AppEnv,
  userId: string,
  workspace: FilesWorkspace,
  repositoryRoot: string,
  path: string,
  maxBytes: number,
  fetch: HttpFetch,
): Promise<FileResponse> {
  checkByteLimit(maxBytes)
  readFilePath(path)
  if (!workspace.sandboxId) throw fileUnavailable()
  const root = repositoryRoot.replace(/\/$/, '')
  if (!root.startsWith('/home/user/') || !readFilePath(root.slice(1))) {
    throw new Error('Configure the absolute repository root under /home/user.')
  }
  const absolutePath = `${root}/${path}`
  let result: SandboxFileRead
  try {
    const provider = await orgProviderForAccount(
      env,
      userId,
      workspace.orgId,
      fetch,
      workspace.providerAccount,
    )
    result = await provider.readFile(
      workspace.sandboxId,
      absolutePath,
      maxBytes,
    )
  } catch (error) {
    if (error instanceof ProviderError) {
      if (error.kind === 'not_found')
        throw new HttpError(404, 'file_not_found', 'The file is not available.')
      if (error.kind === 'invalid_response') throw invalidFileResponse()
      throw fileUnavailable()
    }
    throw error
  }
  if (result.kind === 'too_large')
    throw new FileTooLargeError(result.sizeBytes, result.limitBytes)
  const file = parseFile(
    {
      ...result.file,
      path,
      mediaType: 'application/octet-stream',
    },
    path,
    maxBytes,
  )
  const content = decodeUtf8(fileBytes(file))
  if (content === null) return file
  return {
    ...file,
    encoding: 'utf-8',
    content,
    mediaType: textMediaType(path),
  }
}

function textMediaType(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()
  if (extension === 'md' || extension === 'markdown') return 'text/markdown'
  if (extension === 'json') return 'application/json'
  return 'text/plain'
}
