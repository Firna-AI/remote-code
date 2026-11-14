import type { Workspace } from '../shared/generated/Workspace'
import {
  workspacePath,
  workspacePaths,
  type WorkspaceResponse,
} from '../shared/workspaces'
import type { ApiError } from './api/client'
import { readOrderedWorkspaceResponse } from './api/read-workspaces'
import { ArchiveModel } from './archive-model'
import { detailWithArchive } from './archive-overlay'
import { WorkspaceStream, type Delay } from './events'
import { resumesAtOpen } from './first-start'
import type { OrgModel } from './org-model'
import {
  asApiError,
  derived,
  Store,
  valueOf,
  type Loadable,
  type Readable,
} from './store'
import { WorkspaceReadMarks } from './workspace-read-marks'
import { workspaceMetadata } from './workspace-detail'
import { DetailOrder, type WaitedReply } from './workspace-detail-order'
import { WorkspaceActivity } from './workspace-activity'

/** The open workspace: its state, its start steps, Archive, and Restore. */
export class WorkspaceModel {
  /**
   * The detail as the screen shows it. An Archive of the workspace that
   * runs shows as done, so it feels instant, and a failed one shows the
   * detail as before. The model itself reads the detail of `order`.
   */
  readonly detail: Readable<Loadable<WorkspaceResponse>>
  readonly startError = new Store<ApiError | null>(null)
  /**
   * The open of this visit ended: its read, and the Resume that it sends for
   * a stopped sandbox, or for one whose later start failed. It is false
   * before the first open, during each open, and after `close`. The screen
   * shows the composer in place of the bar of such a sandbox until then,
   * because the open resumes it.
   */
  readonly opened = new Store<boolean>(false)
  readonly archive: ArchiveModel
  readonly stream: WorkspaceStream
  readonly workspaceId: string
  private readonly org: OrgModel
  private readonly activity: WorkspaceActivity
  private readonly order: DetailOrder
  private readonly stops: (() => void)[] = []
  /** Each open and each close counts one up, so an old open knows it is obsolete. */
  private generation = 0
  private readonly readMarks: WorkspaceReadMarks
  private refusedOwnerId: string | null = null
  /** Whether this visit follows the stream and the input of the page. */
  private following = false

  constructor(org: OrgModel, workspaceId: string, delay?: Delay) {
    this.org = org
    this.workspaceId = workspaceId
    this.activity = new WorkspaceActivity(org, workspaceId)
    this.order = new DetailOrder(org, workspaceId, (detail) =>
      this.ownerShown(detail.workspace.owner.id),
    )
    this.detail = derived(
      this.order.detail,
      org.workspaceActions.running,
      (detail, running) => detailWithArchive(detail, running.get(workspaceId)),
    )
    this.stream = new WorkspaceStream(
      org.services.events,
      { orgId: org.orgId, workspaceId },
      delay ?? org.services.delay,
    )
    this.archive = new ArchiveModel(org, workspaceId, (detail) => {
      this.order.lifecycleReply(detail)
      org.workspaceActions.lifecycleChanged(detail.workspace)
    })
    this.readMarks = new WorkspaceReadMarks(
      org.services,
      workspacePaths.read(org.orgId, workspaceId),
      {
        detail: this.order.detail,
        last: this.stream.last,
        suspended: org.suspension.suspended,
        clearUnread: () => this.clearUnread(),
      },
    )
  }

  private get api() {
    return this.org.services.api
  }

  /**
   * Opens the workspace. A stopped sandbox, or one whose later start failed,
   * resumes, and the steps stream in. A failed first start waits for Try
   * again.
   * The input of the user on the page counts as activity until `close`. A
   * call to `close` while the request runs makes its answer obsolete, so an
   * old open never starts the stream again. A suspended org refuses each
   * write, so its workspace sends no Resume, read mark, or activity.
   * An Archive or a Restore while the read waits changes the visit: the open
   * then resumes nothing, because Restore starts nothing. A failed read is
   * then older than the detail of that change, so the detail stays and the
   * visit follows the stream. A later open resumes as before.
   */
  async open(): Promise<void> {
    const run = ++this.generation
    this.opened.set(false)
    try {
      await this.openVisit(run)
    } finally {
      if (run === this.generation) this.opened.set(true)
    }
  }

  /** The read of an open, and its Resume, until `opened`. */
  private async openVisit(run: number): Promise<void> {
    this.order.followList()
    const visit = this.order.lifecycleChanges
    const path = workspacePath(this.org.orgId, this.workspaceId)
    let read: WaitedReply
    try {
      read = await this.order.wait(
        this.api.get(path, readOrderedWorkspaceResponse),
      )
    } catch (error) {
      if (run !== this.generation) return
      if (this.changedInVisit(visit)) this.follow()
      else if (
        valueOf(this.order.detail.get())?.workspace.state !== 'archived'
      ) {
        this.order.detail.set({ state: 'failed', error: asApiError(error) })
      }
      return
    }
    if (run !== this.generation) return
    this.order.confirm(read)
    this.follow()
    if (run !== this.generation || this.suspended) return
    if (this.changedInVisit(visit)) return
    // The shown detail counts an Archive that runs, which resumes nothing.
    const shown = valueOf(this.detail.get())
    if (shown && resumesAtOpen(shown))
      await this.resume().catch(() => undefined)
  }

  /** Whether an Archive or a Restore came to the shown detail in this visit. */
  private changedInVisit(visit: number): boolean {
    return (
      valueOf(this.order.detail.get()) !== undefined &&
      this.order.lifecycleChanges !== visit
    )
  }

  private get suspended(): boolean {
    return this.org.suspension.suspended.get()
  }

  /** Stops the stream. An open that still runs can no longer start it. */
  close(): void {
    this.generation += 1
    this.opened.set(false)
    this.following = false
    this.order.stopFollow()
    this.order.forgetWaits()
    this.readMarks.close()
    this.stream.stop()
    for (const stop of this.stops.splice(0)) stop()
  }

  /**
   * Follows the stream, the read marks, and the input of the page until
   * `close`, once in each visit. A read gives the detail its event number
   * first, so the stream changes only what is newer. After a failed read
   * that an Archive or a Restore of the visit made old, the stream replays
   * from its last applied number: the replay ends with the newest record,
   * and the floor of the newest Archive or Restore keeps each older record
   * out.
   */
  private follow(): void {
    if (this.following) return
    this.following = true
    this.stops.push(
      this.stream.subscribe((envelope) => {
        if (envelope.shell)
          this.order.event(envelope.shell, envelope.eventNumber)
      }),
      // Input anywhere on the page counts, also in a field that stops it.
      this.org.services.onInput(() => this.reportActivity()),
    )
    this.readMarks.open()
    this.stream.start()
  }

  /** A detail with another owner ends the refusal of the owner before it. */
  private ownerShown(ownerId: string): void {
    if (this.refusedOwnerId === null || this.refusedOwnerId === ownerId) return
    this.refusedOwnerId = null
    this.startError.set(null)
  }

  reassigned(workspace: Workspace): void {
    this.org.workspaceActions.reassigned(workspace)
    this.order.local(workspaceMetadata({ owner: workspace.owner }), false)
  }

  /** Takes the name that the list's Rename action already confirmed. */
  renamed(workspace: Workspace): void {
    this.order.local(workspaceMetadata({ name: workspace.name }), false)
  }

  /**
   * Resume of a stopped sandbox, and Try again after a start that failed. Its
   * reply shows only when no newer state of the workspace came first.
   */
  async resume(): Promise<void> {
    const run = this.generation
    const ownerId = valueOf(this.order.detail.get())?.workspace.owner.id
    if (this.startError.get()?.code !== 'user_suspended')
      this.startError.set(null)
    let resumed: WaitedReply
    try {
      resumed = await this.order.wait(
        this.api.send(
          'POST',
          workspacePaths.resume(this.org.orgId, this.workspaceId),
          {},
          readOrderedWorkspaceResponse,
        ),
      )
    } catch (error) {
      const problem = asApiError(error)
      const sameOwner =
        ownerId !== undefined &&
        ownerId === valueOf(this.order.detail.get())?.workspace.owner.id
      if (
        run === this.generation &&
        (problem.code !== 'user_suspended' || sameOwner)
      ) {
        this.refusedOwnerId =
          problem.code === 'user_suspended' ? (ownerId ?? null) : null
        this.startError.set(problem)
      }
      throw error
    }
    if (run !== this.generation) return
    this.refusedOwnerId = null
    this.startError.set(null)
    this.order.confirm(resumed)
  }

  /** Counts input in the open workspace, at most once a minute. */
  reportActivity(): void {
    this.activity.report(valueOf(this.order.detail.get())?.workspace.state)
  }

  private clearUnread(): void {
    if (valueOf(this.order.detail.get())?.workspace.state !== 'unread') return
    // A read that is newer than the stream can name output that no read mark
    // covers yet. It clears after the stream and a mark reach its number.
    if (this.order.through > this.stream.last.get()) return
    this.order.local((current) =>
      current.workspace.state === 'unread'
        ? { ...current, workspace: { ...current.workspace, state: 'ready' } }
        : current,
    )
  }
}
