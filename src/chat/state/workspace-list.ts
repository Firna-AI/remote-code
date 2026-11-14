import type { Workspace } from '../../shared/generated/Workspace'
import { workspacesWait } from '../../app/org-waits'
import { Refresher } from '../../app/refresh'
import { Resource } from '../../app/resource'
import { valueOf, type Readable } from '../../app/store'

import type { ChatApi } from '../api/client'
import type { StreamTimers } from '../stream/workspace-stream'

/** The workspaces whose links the chat shows as chips, and how they stay current. */
export interface WorkspaceList {
  /**
   * The workspaces of the org that the reader may see, with the archived
   * ones, or null until they load.
   */
  readonly workspaces: Readable<readonly Workspace[] | null>
  /**
   * Keeps the list current while the chat shows: a read at once, and reads
   * on a timer. The result ends the watch, so a hidden chat reads nothing.
   */
  watch(): () => void
}

/**
 * The list of a chat that has no sources. It reads the list itself, with
 * the timer of a shown workspace list of the app: soon while a workspace is
 * active, and slowly otherwise. Its reads share one request.
 */
export function ownWorkspaceList(
  api: Pick<ChatApi, 'workspaces'>,
  timers: StreamTimers,
): WorkspaceList {
  const resource = new Resource<readonly Workspace[]>(() => api.workspaces())
  const refresher = new Refresher(resource, workspacesWait, {
    delay: (ms, run) => {
      // A cancelled read never runs, also when its timer is already due.
      let live = true
      const handle = timers.set(() => {
        if (live) void run()
      }, ms)
      return () => {
        live = false
        timers.clear(handle)
      }
    },
    // A chat on its own hears no return of the user to the page.
    onFocus: () => () => undefined,
  })
  return {
    workspaces: {
      get: () => valueOf(resource.store.get()) ?? null,
      subscribe: resource.store.subscribe,
    },
    watch: () => refresher.watch(),
  }
}
