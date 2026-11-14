import type { Session } from '../../shared/generated/Session'
import { Store } from '../../app/store'
import type { SessionsResponse } from '../../shared/sessions'

/** The sessions of a linked workspace, open and closed, as one read gave them. */
export type LinkedSessions =
  | { state: 'loading' }
  | { state: 'ready'; sessions: readonly Session[] }
  | { state: 'failed' }

/**
 * The reads of the session lists of the other workspaces that session links
 * name. Each workspace gets one read for as long as the owner keeps this
 * object: one load of a chat, or one load of New workspace. A reply after
 * `close` changes nothing, so a read of an earlier load never fills a newer
 * one.
 */
export class SessionReads {
  private readonly store = new Store<Readonly<Record<string, LinkedSessions>>>(
    {},
  )
  private readonly read: (workspaceId: string) => Promise<SessionsResponse>
  private closed = false

  constructor(read: (workspaceId: string) => Promise<SessionsResponse>) {
    this.read = read
  }

  readonly subscribe = (listener: () => void) => this.store.subscribe(listener)
  readonly getSnapshot = () => this.store.get()

  /** Reads the sessions of a workspace, unless a read of it ran or runs. */
  readonly need = (workspaceId: string): void => {
    if (this.closed || Object.hasOwn(this.store.get(), workspaceId)) return
    this.put(workspaceId, { state: 'loading' })
    this.read(workspaceId).then(
      (reply) =>
        this.put(workspaceId, {
          state: 'ready',
          sessions: [...reply.sessions, ...reply.history],
        }),
      () => this.put(workspaceId, { state: 'failed' }),
    )
  }

  /** Ends the reads: a later reply changes nothing. */
  close(): void {
    this.closed = true
  }

  private put(workspaceId: string, value: LinkedSessions): void {
    if (this.closed) return
    this.store.change((reads) => ({ ...reads, [workspaceId]: value }))
  }
}
