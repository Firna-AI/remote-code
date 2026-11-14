import type { ChangedFile } from '../../shared/generated/ChangedFile'
import type { DiffResponse } from '../../shared/generated/DiffResponse'
import type { FileResponse } from '../../shared/generated/FileResponse'
import {
  filesFor,
  seedScriptDiff,
} from '../../../docs/mockups/src/fixtures/maskedFiles'
import type { WorkspaceEventEnvelope } from '../../shared/events'

/**
 * The fake value of a secret org env var that two paths of the masked
 * mockups hold. The mockups draw the value as "[redacted]", as the Worker
 * shows it in a label.
 */
const MASKED_VALUE = 'acme-7f3k'

const marker = '[redacted]'

/**
 * A record of the mockups, whose path is a label, as the Worker sends it:
 * the real path, with the label as its display path when the two differ.
 */
export function withRealPath<T extends { path: string }>(
  record: T,
): T & { displayPath?: string } {
  const path = record.path.replaceAll(marker, MASKED_VALUE)
  return path === record.path
    ? record
    : { ...record, path, displayPath: record.path }
}

/** The two changed files of the masked mockups, by their real paths. */
export function maskedChangedFiles(): ChangedFile[] {
  return filesFor('masked')
    .changes.filter((file) => file.path.includes(marker))
    .map(({ path, change, added, removed }) =>
      withRealPath({ path, change, added, removed }),
    )
}

/**
 * A file that moved after its tab opened. No list names it, so its tab and
 * its page show "File", and its read answers that the file is not there.
 */
export const MASKED_GONE_PATH = `src/lib/legacy-${MASKED_VALUE}.ts`

/** The seed script of the masked mockups, by its real path. */
export const MASKED_SEED_PATH = `scripts/seed-${MASKED_VALUE}.sql`

const seedLines = seedScriptDiff
  .flatMap((hunk) => hunk.lines)
  .filter((line) => line.kind === 'added')
  .map((line) => line.text)

/** The read of the masked seed script, with the label of its path. */
export function maskedSeedFile(): FileResponse {
  const content = `${seedLines.join('\n')}\n`
  return withRealPath({
    path: `scripts/seed-${marker}.sql`,
    mediaType: 'application/sql',
    encoding: 'utf-8',
    content,
    sizeBytes: new TextEncoder().encode(content).byteLength,
  })
}

/** The diff of the masked seed script, a new file. */
export function maskedSeedDiff(): DiffResponse {
  return withRealPath({
    path: `scripts/seed-${marker}.sql`,
    baseBranch: 'main',
    oldContent: null,
    newContent: maskedSeedFile().content,
    binary: false,
    patch: `@@ -0,0 +1,${seedLines.length} @@\n${seedLines
      .map((line) => `+${line}\n`)
      .join('')}`,
  })
}

/**
 * The stored chat with the masked files at the end of each finished turn,
 * as the Worker stores them: the real path and its label.
 */
export function withMaskedTurnFiles(
  events: readonly WorkspaceEventEnvelope[],
  masked: readonly ChangedFile[],
): WorkspaceEventEnvelope[] {
  return events.map((envelope) =>
    envelope.event.type === 'turn.completed'
      ? {
          ...envelope,
          event: {
            ...envelope.event,
            files: [...envelope.event.files, ...masked],
          },
        }
      : envelope,
  )
}
