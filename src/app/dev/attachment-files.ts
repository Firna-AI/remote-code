import type { FileResponse } from '../../shared/generated/FileResponse'
import type { Attachment } from '../../shared/generated/Attachment'
import { ATTACHMENTS_DIRECTORY } from '../../shared/attachment-paths'
import {
  filePaths,
  FILE_READ_MAX_BYTES,
  type FileTooLargeResponse,
} from '../../shared/files'
import { workspacePath } from '../../shared/workspaces'
import { FAKE_ORIGIN } from '../../test-support/fixtures/core'
import { toBase64 } from '../screenshots/strip-metadata'
import { ID, json, type Route } from './router'

interface UploadedFile {
  attachment: Attachment
  bytes: ArrayBuffer
}

/** Raw uploads and dispatched copies belong to one development backend. */
class AttachmentFiles {
  private readonly uploads = new Map<string, UploadedFile>()
  private readonly copies = new Map<string, Map<string, UploadedFile>>()

  retain(attachment: Attachment, bytes: ArrayBuffer): void {
    this.uploads.set(attachment.id, { attachment, bytes: bytes.slice(0) })
  }

  copy(
    orgId: string,
    workspaceId: string,
    attachments: readonly Attachment[],
  ): void {
    const key = workspacePath(orgId, workspaceId)
    const files = this.copies.get(key) ?? new Map<string, UploadedFile>()
    for (const attachment of attachments) {
      const uploaded = this.uploads.get(attachment.id)
      if (uploaded && attachment.path !== null) {
        files.set(attachment.path, uploaded)
      }
    }
    this.copies.set(key, files)
  }

  read(
    orgId: string,
    workspaceId: string,
    path: string,
    download: boolean,
  ): Response | null {
    const file = this.copies.get(workspacePath(orgId, workspaceId))?.get(path)
    if (!file) {
      return path.startsWith(`${ATTACHMENTS_DIRECTORY}/`)
        ? json(
            {
              error: {
                code: 'file_not_found',
                message: 'The file is not available.',
              },
            },
            404,
          )
        : null
    }
    const sizeBytes = file.bytes.byteLength
    if (sizeBytes > FILE_READ_MAX_BYTES) {
      return json(
        {
          error: {
            code: 'file_too_large',
            message: 'The file is too large to open.',
            sizeBytes,
            limitBytes: FILE_READ_MAX_BYTES,
          },
        } satisfies FileTooLargeResponse,
        413,
      )
    }
    const { mediaType } = file.attachment
    if (download) {
      return new Response(file.bytes.slice(0), {
        headers: {
          'Content-Type': mediaType,
          'Content-Disposition': 'attachment',
        },
      })
    }
    return json({
      path,
      mediaType,
      sizeBytes,
      encoding: 'base64',
      content: toBase64(new Uint8Array(file.bytes)),
    } satisfies FileResponse)
  }
}

const backends = new WeakMap<object, AttachmentFiles>()

export function attachmentFiles(owner: object): AttachmentFiles {
  let files = backends.get(owner)
  if (!files) {
    files = new AttachmentFiles()
    backends.set(owner, files)
  }
  return files
}

export function attachmentFileRoutes(owner: object): Route[] {
  return (['content', 'download'] as const).map((kind) => ({
    method: 'GET',
    path: new URL(filePaths[kind](ID.org, ID.workspace, ''), FAKE_ORIGIN)
      .pathname,
    answer: ({ params, query }) =>
      attachmentFiles(owner).read(
        params.org,
        params.workspace,
        query.get('path') ?? '',
        kind === 'download',
      ),
  }))
}

export function readCopiedFile(
  owner: object,
  target: { orgId: string; workspaceId: string },
  request: Request,
): Response | null {
  const url = new URL(request.url)
  for (const kind of ['content', 'download'] as const) {
    const route = new URL(
      filePaths[kind](target.orgId, target.workspaceId, ''),
      FAKE_ORIGIN,
    )
    if (url.pathname === route.pathname) {
      return attachmentFiles(owner).read(
        target.orgId,
        target.workspaceId,
        url.searchParams.get('path') ?? '',
        kind === 'download',
      )
    }
  }
  return null
}
