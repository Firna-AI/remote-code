import type { Attachment } from '../shared/generated/Attachment'
import { ATTACHMENT_MAX_BYTES } from '../shared/messages'
import { ApiError } from './api/client'
import { asApiError } from './store'

/**
 * A file of a draft, with its upload. The ID and the `File` stay in each
 * state, so Try again and the upload after an expired draft read the same
 * file, and a late reply finds its file by ID or not at all.
 */
export type DraftFile =
  | {
      state: 'uploading'
      id: string
      file: File
      /**
       * The bytes of the file that the browser measured as sent, or null
       * before the first measurement.
       */
      sentBytes: number | null
    }
  | { state: 'failed'; id: string; file: File; error: ApiError }
  | { state: 'ready'; id: string; file: File; attachment: Attachment }

/** Cancels both a running upload and a reserved place in a pick's queue. */
export function stopFile(
  uploads: Map<string, AbortController>,
  id: string,
): void {
  uploads.get(id)?.abort()
  uploads.delete(id)
}

/**
 * What a drop refused before any upload, by name: each zip of a dropped
 * folder that passed the size limit, and each dropped folder that the
 * browser could not read.
 */
export interface IntakeRefusals {
  tooLarge: readonly string[]
  folders: readonly string[]
}

export const noRefusals: IntakeRefusals = { tooLarge: [], folders: [] }

/** Whether an intake attaches or refuses nothing, such as a cancelled pick. */
export function emptyIntake(
  files: readonly File[],
  refusals: IntakeRefusals,
): boolean {
  return (
    files.length === 0 &&
    refusals.tooLarge.length === 0 &&
    refusals.folders.length === 0
  )
}

/**
 * One intake: the files that upload, the names of the files over the size
 * limit, and the names of the unreadable folders. The names of the zips
 * over the size limit join the files over the limit, after them. Each
 * refused kind stays separate.
 */
export function splitPick(
  files: readonly File[],
  refusals: IntakeRefusals = noRefusals,
): {
  uploads: File[]
  refused: string[]
  refusedFolders: readonly string[]
} {
  return {
    uploads: files.filter((file) => file.size <= ATTACHMENT_MAX_BYTES),
    refused: [
      ...files
        .filter((file) => file.size > ATTACHMENT_MAX_BYTES)
        .map((file) => file.name),
      ...refusals.tooLarge,
    ],
    refusedFolders: [...refusals.folders],
  }
}

export function uploadingFile(id: string, file: File): DraftFile {
  return { state: 'uploading', id, file, sentBytes: null }
}

/** The attachment IDs that a message takes: only those of ready files. */
export function readyIds(files: readonly DraftFile[]): string[] {
  return files.flatMap((item) =>
    item.state === 'ready' ? [item.attachment.id] : [],
  )
}

/** Send waits while a file uploads, or while a failed file waits. */
export function filesWait(files: readonly DraftFile[]): boolean {
  return files.some((item) => item.state !== 'ready')
}

export function hasFile(files: readonly DraftFile[], id: string): boolean {
  return files.some((item) => item.id === id)
}

/** The files with one of them changed. A file that left stays gone. */
export function changeFile(
  files: readonly DraftFile[],
  id: string,
  change: (item: DraftFile) => DraftFile,
): readonly DraftFile[] {
  if (!hasFile(files, id)) return files
  return files.map((item) => (item.id === id ? change(item) : item))
}

/** The server no longer has a file of a message, such as an expired one. */
export function isMissingFile(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === 'attachment_not_found'
}

/**
 * The files after a refusal of a missing file, which names no file: each
 * ready file that the request took turns failed, with its kept `File`, so
 * Try again uploads it again.
 */
export function failSent(
  files: readonly DraftFile[],
  sentIds: readonly string[],
  error: ApiError,
): readonly DraftFile[] {
  return files.map((item) =>
    item.state === 'ready' && sentIds.includes(item.attachment.id)
      ? { state: 'failed', id: item.id, file: item.file, error }
      : item,
  )
}

/** One upload of one file of a draft, as `runFileJob` runs it. */
interface FileJob {
  id: string
  file: File
  /** Its chip is attached, its generation is current, and its owner is live. */
  live: () => boolean
  /** Changes the file in the draft that holds it, wherever that is now. */
  change: (change: (item: DraftFile) => DraftFile) => void
  /** Stops the request of the upload after detachment or sign-out. */
  signal: AbortSignal
  /** Uploads the file, as `uploadAttachment` does, with these hooks. */
  upload: (file: File, hooks: UploadHooks) => Promise<Attachment>
}

/**
 * What an upload reports, the check that it makes before its request, and
 * the signal that stops the request.
 */
export interface UploadHooks {
  progress: (sentBytes: number) => void
  live: () => boolean
  signal: AbortSignal
}

/**
 * Runs the upload of one file and puts its outcome on the file: each
 * measured progress, then ready with its attachment, or failed with the
 * error. After detachment, a change of person, or a stopped chat, the upload
 * starts no request, as its `live` check says, the owner aborts the request
 * that runs, and a reply or a progress that comes later changes nothing.
 */
export async function runFileJob(job: FileJob): Promise<void> {
  if (!job.live() || job.signal.aborted) return
  const { id, file } = job
  try {
    const attachment = await job.upload(file, {
      live: job.live,
      signal: job.signal,
      progress: (sentBytes) => {
        if (!job.live()) return
        job.change((item) =>
          item.state === 'uploading' ? { ...item, sentBytes } : item,
        )
      },
    })
    if (job.live()) job.change(() => ({ state: 'ready', id, file, attachment }))
  } catch (error) {
    if (!job.live()) return
    job.change(() => ({ state: 'failed', id, file, error: asApiError(error) }))
  }
}

/** Starts reserved generations one at a time, also for files restored by undo. */
export async function runFileQueue(
  jobs: readonly (() => Promise<void>)[],
): Promise<void> {
  for (const start of jobs) await start()
}
