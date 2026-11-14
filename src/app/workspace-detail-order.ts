import type { Workspace } from '../shared/generated/Workspace'
import type {
  OrderedWorkspaceResponse,
  WorkspaceResponse,
} from '../shared/workspaces'
import type { ShellEvent } from './api/read-events'
import type { OrgModel } from './org-model'
import type { Change } from './resource'
import { loading, ready, Store, valueOf, type Loadable } from './store'
import {
  archiveFloor,
  detailAfterListLifecycle,
  lifecycleReplyDetail,
  olderAcrossArchive,
  workspaceAfterEvent,
} from './workspace-detail'

/** A read or a Resume reply, with the local changes that came while it waited. */
export interface WaitedReply {
  reply: OrderedWorkspaceResponse
  local: readonly Change<WorkspaceResponse>[]
}

/**
 * The detail of the open workspace, in the order of its sources. A read and
 * a Resume reply carry the event number of their state, and an event of
 * the stream has its own. A source that is older than the state that shows
 * changes nothing, whatever order the sources arrive in. A local change has
 * no number, such as a new owner, an Archive, or a read mark. It shows at
 * once and stays over each reply that waited while it came. `updatedAt`
 * orders the two sides of an Archive and a Restore, so a record from before
 * one that already shows changes nothing, whatever its source. That holds
 * on both sides of the boundary, also for a replay with no read before it.
 */
export class DetailOrder {
  readonly detail = new Store<Loadable<WorkspaceResponse>>(loading)
  private readonly org: OrgModel
  private readonly workspaceId: string
  /** Sees each detail before it shows, such as a new owner. */
  private readonly showing: (detail: WorkspaceResponse) => void
  private shownThrough = 0
  /** The `updatedAt` of the newest Archive or Restore that showed. */
  private floor = Number.NEGATIVE_INFINITY
  private transitions = 0
  private readonly waiting = new Set<Change<WorkspaceResponse>[]>()
  private stopList: (() => void) | null = null

  constructor(
    org: OrgModel,
    workspaceId: string,
    showing: (detail: WorkspaceResponse) => void,
  ) {
    this.org = org
    this.workspaceId = workspaceId
    this.showing = showing
  }

  /**
   * The workspace event number whose state the detail shows, from its read,
   * a Resume reply, or an event of the stream.
   */
  get through(): number {
    return this.shownThrough
  }

  /**
   * The count of the Archive and Restore changes that the detail took: each
   * reply of this workspace that is newer than the detail, and each record
   * of the list that the detail follows. A reply that came before each
   * detail counts when the list shows it. An open compares the count to
   * know that a change came while its read waited.
   */
  get lifecycleChanges(): number {
    return this.transitions
  }

  /** An Archive or a Restore reply. Only the fields of the archive change. */
  lifecycleReply(reply: WorkspaceResponse): void {
    const current = valueOf(this.detail.get())
    if (current && lifecycleReplyDetail(current, reply) !== current) {
      this.transitions += 1
    }
    this.local((value) => lifecycleReplyDetail(value, reply), false)
  }

  /** Waits for a read or a Resume, and keeps the local changes of the wait. */
  async wait(request: Promise<OrderedWorkspaceResponse>): Promise<WaitedReply> {
    const local: Change<WorkspaceResponse>[] = []
    this.waiting.add(local)
    try {
      return { reply: await request, local }
    } finally {
      this.waiting.delete(local)
    }
  }

  /** Ends each wait, so a later local change goes to no old reply. */
  forgetWaits(): void {
    this.waiting.clear()
  }

  /**
   * Shows a read or a Resume reply when no newer state has shown, with the
   * local changes that came after it. The first read shows unless an
   * Archive of the list came first, because no other detail shows before it.
   * A reply from before an Archive or a Restore that already shows changes
   * nothing, whatever its number, because the change came after its state.
   * A newer Archive, Restore, or end of Restore of the list stays over the
   * reply, in the detail and in the list.
   */
  confirm({ reply, local }: WaitedReply): void {
    const shown = valueOf(this.detail.get())
    if (shown && reply.eventNumber < this.shownThrough) return
    this.shownThrough = reply.eventNumber
    if (shown && this.stale(reply.workspace)) return
    const { workspace, start, error } = reply
    const next = local.reduce((value, change) => change(value), {
      workspace,
      start,
      error,
    })
    const listed = this.org.confirmedWorkspace(this.workspaceId)
    this.show(detailAfterListLifecycle(next, listed) ?? next)
  }

  /** Applies an event of the stream that is newer than the detail. */
  event(event: ShellEvent, eventNumber: number): void {
    const detail = valueOf(this.detail.get())
    if (!detail || eventNumber <= this.shownThrough) return
    this.shownThrough = eventNumber
    const next = workspaceAfterEvent(detail, event)
    if (next !== detail) this.show(next)
  }

  /** A local change with no number, which stays over waiting replies. */
  local(change: Change<WorkspaceResponse>, updateList = true): void {
    for (const changes of this.waiting) changes.push(change)
    const detail = valueOf(this.detail.get())
    if (!detail) return
    this.show(change(detail), updateList)
  }

  /**
   * Follows the list until `stopFollow`: an Archive or a Restore that the
   * list confirmed, such as one of a row of the list, in both directions,
   * and a newer record of an archived workspace, such as the end of its
   * Restore. Only the fields of the archive change.
   */
  followList(): void {
    this.stopList ??= this.org.confirmedWorkspaces.subscribe(() =>
      this.syncLifecycle(),
    )
    this.syncLifecycle()
  }

  stopFollow(): void {
    this.stopList?.()
    this.stopList = null
  }

  private syncLifecycle(): void {
    const current = valueOf(this.detail.get())
    const listed = this.org.confirmedWorkspace(this.workspaceId)
    const next = detailAfterListLifecycle(current, listed)
    if (!next) return
    this.transitions += 1
    if (current) this.local((value) => lifecycleReplyDetail(value, next), false)
    else this.show(next, false)
  }

  /**
   * Whether a record is older than the shown Archive or Restore: below the
   * floor, or older across the archive boundary than the shown record.
   */
  private stale(record: Workspace): boolean {
    const current = valueOf(this.detail.get())
    return (
      record.updatedAt < this.floor ||
      (current !== undefined && olderAcrossArchive(current.workspace, record))
    )
  }

  /**
   * Shows a detail. A record that is older than the shown Archive or Restore
   * changes nothing, whatever its source: an older read, an older event, or
   * an older Archive or Restore reply. So a Restore stays over the Archive
   * that it undid, and an Archive stays over the state before it.
   */
  private show(detail: WorkspaceResponse, updateList = true): void {
    if (this.stale(detail.workspace)) return
    const current = valueOf(this.detail.get())
    this.floor = archiveFloor(this.floor, current?.workspace, detail.workspace)
    this.showing(detail)
    this.detail.set(ready(detail))
    if (updateList) this.org.putWorkspace(detail.workspace)
  }
}
