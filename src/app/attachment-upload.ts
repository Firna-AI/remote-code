import type { Attachment } from '../shared/generated/Attachment'
import {
  attachmentUploadUrl,
  type AttachmentUploadTarget,
} from '../shared/messages'
import type { ApiClient } from './api/client'
import { nested, record } from './api/parse'
import { readAttachment } from './api/read-workspaces'

/** One upload of a file, to a workspace or to the first message of a new one. */
interface AttachmentUploadJob {
  api: ApiClient
  orgId: string
  target: AttachmentUploadTarget
  file: File
  /** Gets the number of bytes of the file that the browser sent so far. */
  progress: (sentBytes: number) => void
  /**
   * The upload may still start: its file is in the draft, and the person
   * and the chat that started it go on.
   */
  live: () => boolean
  /** Stops the request that runs, such as after Remove or a sign-out. */
  signal: AbortSignal
}

/** The upload stopped before its request, because `live` said no. */
class UploadStopped extends Error {}

/**
 * Uploads one file and gives its attachment. Both composers upload only
 * through this function. It sends the raw file in one request to the route
 * of the target. The address names the file and its media type, and the
 * message of a new workspace. The browser measures the bytes that it sent,
 * through `progress`. No request starts when `live` says no, and `signal`
 * stops one that runs. A failure throws the client's `ApiError`.
 */
export async function uploadAttachment(
  job: AttachmentUploadJob,
): Promise<Attachment> {
  if (!job.live()) throw new UploadStopped('The upload stopped.')
  const { file } = job
  const mediaType = file.type || 'application/octet-stream'
  return job.api.sendFile(
    attachmentUploadUrl(job.orgId, job.target, { name: file.name, mediaType }),
    file,
    (body) => nested(record(body), 'attachment', readAttachment),
    { progress: job.progress, signal: job.signal },
  )
}
