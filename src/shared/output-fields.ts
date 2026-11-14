import type { ChangedFile } from './generated/ChangedFile'
import type { ChangesResponse } from './generated/ChangesResponse'
import type { DiffResponse } from './generated/DiffResponse'
import type { FileEntry } from './generated/FileEntry'
import type { FileResponse } from './generated/FileResponse'
import type { FileTreeResponse } from './generated/FileTreeResponse'
import type { RunnerFileEvent } from './generated/RunnerFileEvent'
import type { RunnerEvent } from './generated/RunnerEvent'
type FilterText = (value: string) => string

function pathLabel<T extends { path: string; displayPath?: string }>(
  value: T,
  text: FilterText,
): T {
  const displayPath = text(value.displayPath || value.path)
  return displayPath === value.path && value.displayPath === undefined
    ? value
    : { ...value, displayPath }
}

function baseLabel<
  T extends { baseBranch: string; displayBaseBranch?: string },
>(value: T, text: FilterText): T {
  const displayBaseBranch = text(value.displayBaseBranch || value.baseBranch)
  return displayBaseBranch === value.baseBranch &&
    value.displayBaseBranch === undefined
    ? value
    : { ...value, displayBaseBranch }
}

function fileEntry(entry: FileEntry, text: FilterText): FileEntry {
  return { ...pathLabel(entry, text), name: text(entry.name) }
}

function changedFile<T extends ChangedFile>(file: T, text: FilterText): T {
  const result = pathLabel(file, text)
  if (file.previousPath === undefined) return result
  const previousDisplayPath = text(
    file.previousDisplayPath || file.previousPath,
  )
  return previousDisplayPath === file.previousPath &&
    file.previousDisplayPath === undefined
    ? result
    : { ...result, previousDisplayPath }
}

export function filterTree<T extends FileTreeResponse>(
  tree: T,
  text: FilterText,
): T {
  return {
    ...tree,
    entries: tree.entries.map((entry) => fileEntry(entry, text)),
  }
}

export function filterChanges<T extends ChangesResponse>(
  changes: T,
  text: FilterText,
): T {
  return {
    ...baseLabel(changes, text),
    files: changes.files.map((file) => changedFile(file, text)),
  }
}

export function filterFileResponse(
  file: FileResponse,
  text: FilterText,
): FileResponse {
  return pathLabel(file, text)
}

export function filterDiffResponse(
  diff: DiffResponse,
  text: FilterText,
): DiffResponse {
  return baseLabel(pathLabel(diff, text), text)
}

export function filterFileReport(
  event: RunnerFileEvent,
  text: FilterText,
): RunnerFileEvent {
  if (event.type === 'files.snapshot')
    return {
      ...event,
      tree: filterTree(event.tree, text),
    }
  if (event.type === 'files.changed')
    return {
      ...event,
      delta: {
        ...event.delta,
        changes: event.delta.changes.map((change) => {
          if (change.operation === 'remove') return change
          if (change.operation === 'move')
            return {
              ...change,
              entry: fileEntry(change.entry, text),
            }
          return { ...change, entry: fileEntry(change.entry, text) }
        }),
      },
    }
  if (event.type === 'changes.updated')
    return {
      ...event,
      changes: filterChanges(event.changes, text),
    }
  return event
}

export function filterRetainedReport(
  event: RetainedReport,
  text: FilterText,
): RetainedReport {
  if (event.type === 'workspace.title')
    return { ...event, name: text(event.name) }
  return {
    ...event,
    start: {
      ...event.start,
      steps: event.start.steps.map((step) => ({
        ...step,
        label: text(step.label),
      })),
    },
  }
}

/** Filter displayed output without changing protocol fields or identities. */
export function filterOutput(
  event: RunnerEvent,
  text: FilterText,
): RunnerEvent {
  if (
    event.type === 'files.snapshot' ||
    event.type === 'files.changed' ||
    event.type === 'files.unavailable' ||
    event.type === 'changes.updated'
  )
    return filterFileReport(event, text)
  if (event.type === 'workspace.title' || event.type === 'start.updated')
    return filterRetainedReport(event, text)
  if (event.type === 'ports.updated')
    return {
      ...event,
      ports: event.ports.map((port) => ({
        ...port,
        name: port.name === null ? null : text(port.name),
        folder: port.folder === null ? null : text(port.folder),
      })),
    }
  if (event.type === 'assistant.delta' || event.type === 'assistant.completed')
    return { ...event, text: text(event.text) }
  if (event.type === 'tool.updated')
    return {
      ...event,
      tool: {
        ...event.tool,
        target: text(event.tool.target),
        detail: event.tool.detail === null ? null : text(event.tool.detail),
      },
    }
  if (event.type === 'turn.completed')
    return {
      ...event,
      files: event.files.map((file) => changedFile(file, text)),
    }
  if (event.type === 'turn.failed')
    return {
      ...event,
      error: { ...event.error, message: text(event.error.message) },
    }
  return event
}
type RetainedReport = Extract<
  RunnerEvent,
  { type: 'start.updated' | 'workspace.title' }
>
