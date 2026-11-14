import type { RunnerFileEvent } from '../../src/shared/generated/RunnerFileEvent'
import type { RunnerFileRevisionPart } from '../../src/shared/generated/RunnerFileRevisionPart'
import type { FileEvent } from '../../src/shared/files'
import {
  emptySequence,
  loadReportState,
  reportPartUpdates,
  REPORT_KEY,
  storedPart,
  storedParts,
  storedReportKeys,
  type ReportKind,
  type ReportState,
} from './report-storage'
import { FilesState } from './state'
import type { FilesStorage } from './storage'

export class InvalidRunnerReport extends Error {}
const invalid = (): never => {
  throw new InvalidRunnerReport('The runner report is invalid.')
}

function revisionPart(event: RunnerFileEvent): RunnerFileRevisionPart {
  if (event.type === 'files.snapshot') return event.tree
  if (event.type === 'changes.updated') return event.changes
  return invalid()
}

function joinReport(
  parts: readonly RunnerFileEvent[],
  complete: boolean,
): FileEvent {
  const first = parts[0]
  if (first?.type === 'files.snapshot') {
    const entries = parts.flatMap((part) =>
      part.type === 'files.snapshot' ? part.tree.entries : invalid(),
    )
    if (
      new Set(entries.map((entry) => entry.path)).size !== entries.length ||
      (complete && entries.length === 0 && first.tree.partCount !== 1)
    )
      invalid()
    return {
      type: first.type,
      tree: { revision: first.tree.revision, entries },
    }
  }
  if (first?.type !== 'changes.updated') return invalid()
  const files = parts.flatMap((part) => {
    if (
      part.type !== 'changes.updated' ||
      part.changes.baseBranch !== first.changes.baseBranch ||
      part.changes.unpushedCommits !== first.changes.unpushedCommits ||
      part.changes.uncommittedFileCount !==
        first.changes.uncommittedFileCount ||
      JSON.stringify(part.changes.summary) !==
        JSON.stringify(first.changes.summary)
    )
      return invalid()
    return part.changes.files
  })
  const summary = { files: files.length, added: 0, removed: 0 }
  for (const file of files) {
    summary.added += file.added
    summary.removed += file.removed
  }
  const reported = first.changes.summary
  if (
    new Set(files.map((entry) => entry.path)).size !== files.length ||
    (complete &&
      (reported.files !== summary.files ||
        reported.added !== summary.added ||
        reported.removed !== summary.removed ||
        (files.length === 0 && first.changes.partCount !== 1)))
  )
    invalid()
  return {
    type: first.type,
    changes: {
      baseBranch: first.changes.baseBranch,
      ...(first.changes.unpushedCommits === undefined
        ? {}
        : { unpushedCommits: first.changes.unpushedCommits }),
      ...(first.changes.uncommittedFileCount === undefined
        ? {}
        : { uncommittedFileCount: first.changes.uncommittedFileCount }),
      ...(first.changes.displayBaseBranch === undefined
        ? {}
        : { displayBaseBranch: first.changes.displayBaseBranch }),
      summary,
      files,
    },
  }
}

/** All writes use the owner's receipt transaction, including the last projection. */
export class RunnerFileReports {
  private readonly storage: FilesStorage

  constructor(storage: FilesStorage) {
    this.storage = storage
  }

  async beginStream(streamId: string): Promise<void> {
    const previous = await loadReportState(this.storage)
    if (previous?.streamId === streamId) return
    const state: ReportState = {
      streamId,
      tree: emptySequence(),
      changes: emptySequence(),
    }
    await new FilesState(this.storage).beginConnection(streamId)
    await this.storage.write(
      { [REPORT_KEY]: state },
      previous
        ? [
            ...(await storedReportKeys(
              this.storage,
              'tree',
              previous.tree.report,
            )),
            ...(await storedReportKeys(
              this.storage,
              'changes',
              previous.changes.report,
            )),
          ]
        : [],
    )
  }

  async refuse(type: string): Promise<void> {
    const kind =
      type === 'changes.updated'
        ? 'changes'
        : type === 'files.snapshot' || type === 'files.changed'
          ? 'tree'
          : null
    if (!kind) return
    const state = await this.state()
    const sequence = state[kind]
    const report = sequence.report
    const removals =
      report && report.through < report.partCount
        ? await storedReportKeys(this.storage, kind, report)
        : []
    if (removals.length) sequence.report = null
    sequence.seen = true
    await this.storage.write({ [REPORT_KEY]: state }, removals)
  }

  async accept(event: RunnerFileEvent): Promise<FileEvent | null> {
    const state = await this.state()
    if (event.type === 'files.unavailable') {
      await this.apply(state, event)
      return event
    }
    if (event.type === 'files.changed') {
      const sequence = state.tree
      if (
        !sequence.appliedRevision ||
        event.delta.revision !== sequence.appliedRevision + 1 ||
        (sequence.report && sequence.report.through < sequence.report.partCount)
      )
        invalid()
      sequence.appliedRevision = event.delta.revision
      await this.apply(state, event)
      return event
    }
    const kind: ReportKind =
      event.type === 'files.snapshot' ? 'tree' : 'changes'
    const sequence = state[kind]
    const part = revisionPart(event)
    const previous = sequence.report
    const sameRevision = previous?.revision === part.revision
    if (sameRevision && previous) {
      if (previous.partCount !== part.partCount) invalid()
      if (part.partNumber <= previous.through) {
        const stored = await storedPart(this.storage, kind, part.partNumber)
        if (JSON.stringify(stored) !== JSON.stringify(event)) invalid()
        return null
      }
      if (part.partNumber !== previous.through + 1) invalid()
    } else if (
      part.partNumber !== 1 ||
      part.revision <= sequence.appliedRevision ||
      (!sequence.seen && part.revision !== 1) ||
      (previous && part.revision <= previous.revision)
    )
      invalid()
    const parts =
      sameRevision && previous
        ? await storedParts(this.storage, kind, previous)
        : []
    parts.push(event)
    // Validate metadata and path uniqueness as each part arrives, before any write.
    const joined = joinReport(parts, part.partNumber === part.partCount)
    const complete = part.partNumber === part.partCount ? joined : null
    sequence.seen = true
    sequence.report = {
      revision: part.revision,
      partCount: part.partCount,
      through: part.partNumber,
    }
    if (complete) sequence.appliedRevision = part.revision
    const updates = {
      ...reportPartUpdates(kind, part.partNumber, event),
      [REPORT_KEY]: state,
    }
    const removals = sameRevision
      ? []
      : (await storedReportKeys(this.storage, kind, previous)).filter(
          (key) => !(key in updates),
        )
    await this.storage.write(updates, removals)
    if (complete) await this.apply(state, complete)
    return complete
  }

  private async state(): Promise<ReportState> {
    const state = await loadReportState(this.storage)
    if (!state) throw new Error('Start the runner stream before its reports.')
    return state
  }

  private async apply(state: ReportState, event: FileEvent): Promise<void> {
    const accepted = await new FilesState(this.storage).apply(
      state.streamId,
      event,
    )
    if (!accepted)
      throw new Error('The complete runner report could not be stored.')
    await this.storage.write({ [REPORT_KEY]: state }, [])
  }
}
