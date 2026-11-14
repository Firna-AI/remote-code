import type { ChangedFile } from '../../shared/generated/ChangedFile'
import type { ChangeKind } from '../../shared/generated/ChangeKind'
import { count, oneOf, optional, record, text } from './json'

const readChange = oneOf<ChangeKind>({
  added: true,
  modified: true,
  deleted: true,
  renamed: true,
  untracked: true,
})

/** A display label, or nothing. A label never makes an event unreadable. */
function label(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * A file that a turn changed. `path` stays the real path that opens its
 * diff, and `displayPath` is the label that hides a secret value.
 */
export function readChangedFile(value: unknown): ChangedFile {
  const source = record(value, 'file')
  const displayPath = label(source.displayPath)
  const previousPath = optional(text)(source.previousPath)
  const previousDisplayPath = label(source.previousDisplayPath)
  return {
    path: text(source.path),
    ...(displayPath === undefined ? {} : { displayPath }),
    ...(previousPath === undefined ? {} : { previousPath }),
    ...(previousPath === undefined || previousDisplayPath === undefined
      ? {}
      : { previousDisplayPath }),
    change: readChange(source.change),
    added: count(source.added),
    removed: count(source.removed),
  }
}
