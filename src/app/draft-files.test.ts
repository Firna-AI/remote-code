import { describe, expect, test } from 'vitest'
import type { Attachment } from '../shared/generated/Attachment'
import { deferred, type Deferred } from '../test-support/mount'
import { runFileJob, uploadingFile, type DraftFile } from './draft-files'

const file = new File(['png'], 'overlap.png', { type: 'image/png' })
const attachment: Attachment = {
  id: 'attachment-1',
  name: 'overlap.png',
  path: null,
  kind: 'image',
  mediaType: 'image/png',
  sizeBytes: 3,
}

/**
 * Runs one job whose owner applies each change, as a draft that keeps the
 * file would, and stops being live before the reply comes.
 */
async function lateReply(settle: (reply: Deferred<Attachment>) => void) {
  let live = true
  const reply = deferred<Attachment>()
  const states: DraftFile['state'][] = []
  const job = runFileJob({
    id: 'file-1',
    file,
    live: () => live,
    signal: new AbortController().signal,
    change: (change) =>
      states.push(change(uploadingFile('file-1', file)).state),
    upload: () => reply.promise,
  })
  live = false
  settle(reply)
  await job
  return states
}

describe('runFileJob', () => {
  test('changes no file when its reply comes after the file stopped being live', async () => {
    expect({
      ready: await lateReply((reply) => reply.resolve(attachment)),
      failed: await lateReply((reply) => reply.reject(new Error('Offline'))),
    }).toEqual({ ready: [], failed: [] })
  })
})
