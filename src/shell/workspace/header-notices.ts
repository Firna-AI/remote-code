import type { RunnerReportKind } from '../../shared/generated/RunnerReportKind'
import type { StreamEnvelope } from '../../app/api/read-events'
import type { WorkspaceStream } from '../../app/events'
import { Store } from '../../app/store'

/** Workspace data under the header that a later full report replaces. */
export type HeaderReportKind = Extract<
  RunnerReportKind,
  'workspace.title' | 'start.updated'
>

/** A failed repair that the header shows, and when it failed. */
export interface HeaderNotice {
  kind: HeaderReportKind
  /** When the workspace refused the fresh report, in Unix milliseconds. */
  at: number
}

/** The order of the notices under the header: the name first. */
const order: readonly HeaderReportKind[] = ['workspace.title', 'start.updated']

function isHeaderKind(value: unknown): value is HeaderReportKind {
  return order.some((kind) => kind === value)
}

/**
 * The failed repair that a refusal marker records. The workspace refused an
 * update without a session, asked the runner for a fresh full report, and
 * refused that report too. Only that marker says `repairFailed`, so the
 * first loss records nothing. A marker with a session belongs to the chat.
 */
function failedRepair(envelope: StreamEnvelope): HeaderNotice | null {
  const { event } = envelope
  if (envelope.type !== 'runner.event-refused') return null
  if (event.repairFailed !== true || event.sessionId !== null) return null
  const kind = event.runnerEventType
  return isHeaderKind(kind) ? { kind, at: envelope.occurredAt } : null
}

/**
 * The failed repairs of the workspace name and the start steps, which the
 * header shows. A failure stays until a later full report of its kind in the
 * stream. A reply of a route clears nothing, because the workspace keeps the
 * report from before the loss. A further failure of a failed kind keeps the
 * time of the first one.
 *
 * Dismiss hides a notice in this view only. The failure stays, so a new view
 * or a new tab shows it again. A new tab reads it from the stored history. A
 * tab that keeps the store calls `newView` when the workspace shows again.
 * The next failure after a full report shows again here too.
 */
export class HeaderNotices {
  /** The notices that the header shows, the name first. */
  readonly shown = new Store<readonly HeaderNotice[]>([])
  private readonly failed = new Map<HeaderReportKind, number>()
  private readonly dismissed = new Set<HeaderReportKind>()

  /**
   * Follows the ordered events of the workspace. Call it before the stream
   * starts, so that the stored history counts.
   */
  follow(stream: WorkspaceStream): () => void {
    const stop = stream.subscribe((envelope) => this.take(envelope))
    return () => {
      stop()
    }
  }

  /** Starts a new view: each failed repair shows again, also a dismissed one. */
  newView(): void {
    if (this.dismissed.size === 0) return
    this.dismissed.clear()
    this.publish()
  }

  /** Hides the notice of this kind in this view. The failure stays. */
  dismiss(kind: HeaderReportKind): void {
    if (!this.failed.has(kind) || this.dismissed.has(kind)) return
    this.dismissed.add(kind)
    this.publish()
  }

  private take(envelope: StreamEnvelope): void {
    const failure = failedRepair(envelope)
    if (failure) {
      if (this.failed.has(failure.kind)) return
      this.failed.set(failure.kind, failure.at)
      return this.publish()
    }
    // The shell reads a full report of the name or the start steps. It is
    // the report that the workspace model applies.
    const kind = envelope.shell?.type
    if (!isHeaderKind(kind) || !this.failed.delete(kind)) return
    this.dismissed.delete(kind)
    this.publish()
  }

  private publish(): void {
    this.shown.set(
      order.flatMap((kind) => {
        const at = this.failed.get(kind)
        return at === undefined || this.dismissed.has(kind)
          ? []
          : [{ kind, at }]
      }),
    )
  }
}
