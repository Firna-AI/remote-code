import type { Session } from '../../shared/generated/Session'

import type { ChatSnapshot } from './chat-snapshot'
import type { ChatContext } from './context'
import { hydrate } from './history'
import { withSessionPlaces } from './tab-order'
import { neighbour, pickActive } from './sessions'

/**
 * A read-only workspace keeps its chat as it is, and the backend refuses
 * its writes: an archived workspace, and a workspace of a suspended org. So
 * its session tabs change in the browser only: the reader opens the stored
 * history of any session as a tab, and closes that tab again. The stored
 * session records never change, so a closed session stays closed.
 * `archiveTabs` holds the IDs of these tabs, and the records stay in
 * `sessions` and `history`.
 */
export function isArchived(snapshot: ChatSnapshot): boolean {
  return snapshot.workspace?.state === 'archived'
}

/** The IDs of the session tabs: the open sessions, until a local change. */
function tabIds(snapshot: ChatSnapshot): readonly string[] {
  return snapshot.archiveTabs ?? snapshot.sessions.map((item) => item.id)
}

/** The sessions whose tabs show, in the order of the tabs. */
export function tabSessions(snapshot: ChatSnapshot): readonly Session[] {
  if (snapshot.archiveTabs === null) return snapshot.sessions
  const known = [...snapshot.sessions, ...snapshot.history]
  return snapshot.archiveTabs.flatMap(
    (id) => known.find((item) => item.id === id) ?? [],
  )
}

/**
 * The sessions that the session history lists: the closed sessions. In a
 * read-only workspace, it lists each session without a tab, so a tab that
 * the reader closed shows there again, also one of a session that was open
 * at the archive. `readOnly` is true for an archived workspace, and for a
 * workspace that the host shows read-only.
 */
export function historySessions(
  snapshot: ChatSnapshot,
  readOnly = isArchived(snapshot),
): readonly Session[] {
  if (!readOnly) return snapshot.history
  const shown = new Set(tabIds(snapshot))
  return [...snapshot.sessions, ...snapshot.history].filter(
    (item) => !shown.has(item.id),
  )
}

/**
 * When a session ended: its close, or the archive for a session that was
 * open at the archive. Null while it is open.
 */
export function endedAt(
  snapshot: ChatSnapshot,
  session: Session,
): number | null {
  if (session.closedAt !== null || !isArchived(snapshot)) {
    return session.closedAt
  }
  return snapshot.workspace?.archivedAt ?? null
}

/**
 * Shows a session of a read-only workspace as a tab and as the shown
 * session, and loads its stored history. It writes nothing. Each call is a
 * choice of a shown session, which an older address lookup yields to.
 */
export async function showLocally(
  context: ChatContext,
  sessionId: string,
): Promise<void> {
  context.tabChoices.count += 1
  const snapshot = context.store.get()
  const known = [...snapshot.sessions, ...snapshot.history]
  if (!known.some((item) => item.id === sessionId)) return
  const ids = tabIds(snapshot)
  const opening = !ids.includes(sessionId)
  context.store.update((current) => ({
    ...current,
    archiveTabs: opening ? [...ids, sessionId] : ids,
    view:
      opening && current.view
        ? {
            ...current.view,
            tabs: [
              ...current.view.tabs.filter(
                (tab) => tab.kind !== 'session' || tab.sessionId !== sessionId,
              ),
              { kind: 'session', sessionId },
            ],
          }
        : current.view,
    activeSessionId: sessionId,
    overlay: { kind: 'none' },
  }))
  await hydrate(context, sessionId)
}

/**
 * Closes the tab of a session of a read-only workspace. The next tab shows.
 * It writes nothing, and the session stays in the session history.
 */
export function closeLocally(context: ChatContext, sessionId: string): void {
  context.store.update((snapshot) => {
    const shown = tabSessions(snapshot)
    if (!shown.some((item) => item.id === sessionId)) return snapshot
    const active =
      snapshot.activeSessionId === sessionId
        ? neighbour(shown, sessionId)
        : snapshot.activeSessionId
    return {
      ...snapshot,
      view: snapshot.view && {
        ...snapshot.view,
        tabs: snapshot.view.tabs.filter(
          (tab) => tab.kind !== 'session' || tab.sessionId !== sessionId,
        ),
      },
      archiveTabs: shown
        .filter((item) => item.id !== sessionId)
        .map((item) => item.id),
      activeSessionId: active,
    }
  })
}

/**
 * The snapshot after its workspace left the archived state, such as after a
 * Restore. The tabs that changed in the browser only end, so the open
 * sessions show in their saved order again. An overlay that the archive hid,
 * such as a question before a close, ends too. A session that the reader
 * showed from the history gives way to an open one.
 */
export function afterRestore(snapshot: ChatSnapshot): ChatSnapshot {
  const open = snapshot.sessions.some(
    (item) => item.id === snapshot.activeSessionId,
  )
  return {
    ...snapshot,
    archiveTabs: null,
    overlay: { kind: 'none' },
    activeSessionId: open
      ? snapshot.activeSessionId
      : pickActive(snapshot.sessions, snapshot.view),
  }
}

/**
 * Reads the saved view again after a Restore, because the read-only visit
 * changed its tabs in the browser only. A change of the view after the
 * Restore wins over the read, and a read that fails keeps the view.
 */
export async function reloadView(context: ChatContext): Promise<void> {
  const before = context.store.get().view
  const reply = await context.api.view().catch(() => null)
  if (!context.live() || reply === null) return
  context.store.update((snapshot) =>
    snapshot.view === before && !isArchived(snapshot)
      ? { ...snapshot, view: withSessionPlaces(reply.view, snapshot.sessions) }
      : snapshot,
  )
}
