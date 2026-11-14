import type { Attachment } from '../../src/shared/generated/Attachment'
import { attachmentPath } from '../../src/shared/attachment-paths'

export function fakeAttachments(
  ids: readonly string[],
): Promise<(Attachment & { path: string })[]> {
  return Promise.all(
    ids.map(async (id) => {
      const file = { id, name: `${id}.txt` }
      return {
        ...file,
        path: await attachmentPath(file),
        kind: 'file' as const,
        mediaType: 'text/plain',
        sizeBytes: 7,
      }
    }),
  )
}
