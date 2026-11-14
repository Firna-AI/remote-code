import type { Session } from '../../shared/generated/Session'

import type { WorkspaceTab, WorkspaceView } from '../../shared/workspace-view'
import type { ChatSnapshot } from './chat-snapshot'
import { withSessionPlace } from './tab-order'

const isSessionTab = (
  tab: WorkspaceTab | null,
): tab is Extract<WorkspaceTab, { kind: 'session' }> => tab?.kind === 'session'

/** Open sessions in the order of their tabs, then the ones with no tab yet. */
export function orderSessions(
  open: readonly Session[],
  view: WorkspaceView | null,
): Session[] {
  const order = (view?.tabs ?? [])
    .filter(isSessionTab)
    .map((tab) => tab.sessionId)
  const rank = (session: Session) => {
    const index = order.indexOf(session.id)
    return index < 0 ? order.length : index
  }
  return [...open].sort(
    (left, right) =>
      rank(left) - rank(right) || left.createdAt - right.createdAt,
  )
}

/** The session that the view shows, or the first open session. */
export function pickActive(
  open: readonly Session[],
  view: WorkspaceView | null,
): string | null {
  const active = view?.activeTab ?? null
  if (
    isSessionTab(active) &&
    open.some((item) => item.id === active.sessionId)
  ) {
    return active.sessionId
  }
  return open[0]?.id ?? null
}

/** The view with the session's tab, made the active tab. */
export function viewShowing(
  view: WorkspaceView | null,
  sessionId: string,
): WorkspaceView {
  const tab: WorkspaceTab = { kind: 'session', sessionId }
  const base = view ?? {
    tabs: [],
    activeTab: null,
    temporaryTab: null,
    fileList: 'all',
    tool: 'terminal',
  }
  const present = base.tabs.some(
    (item) => isSessionTab(item) && item.sessionId === sessionId,
  )
  return {
    ...base,
    tabs: present ? base.tabs : [...base.tabs, tab],
    activeTab: tab,
  }
}

/** The view without the session's tab. The next session takes its place. */
function viewWithout(
  view: WorkspaceView,
  sessionId: string,
  next: string | null,
): WorkspaceView {
  const tabs = view.tabs.filter(
    (tab) => !(isSessionTab(tab) && tab.sessionId === sessionId),
  )
  const closedActive =
    isSessionTab(view.activeTab) && view.activeTab.sessionId === sessionId
  if (!closedActive) return { ...view, tabs }
  return {
    ...view,
    tabs,
    activeTab: next ? { kind: 'session', sessionId: next } : null,
  }
}

/** The session that takes the place of a closed tab: the next, else the one before. */
export function neighbour(
  open: readonly Session[],
  sessionId: string,
): string | null {
  const index = open.findIndex((item) => item.id === sessionId)
  const rest = open.filter((item) => item.id !== sessionId)
  if (rest.length === 0) return null
  return (rest[Math.min(Math.max(index, 0), rest.length - 1)] ?? rest[0]).id
}

const lastClosedFirst = (left: Session, right: Session) =>
  (right.closedAt ?? 0) - (left.closedAt ?? 0)

/**
 * Puts a session record where it belongs: an open session among the tabs, a
 * closed one in the history, the last closed first. When the open session
 * closes, the next session becomes the open one.
 */
export function placeSession(
  snapshot: ChatSnapshot,
  session: Session,
): ChatSnapshot {
  const others = (list: readonly Session[]) =>
    list.filter((item) => item.id !== session.id)
  const known = snapshot.sessions.findIndex((item) => item.id === session.id)
  if (session.closedAt === null) {
    const sessions =
      known < 0
        ? [...snapshot.sessions, session]
        : snapshot.sessions.map((item) =>
            item.id === session.id ? session : item,
          )
    const view = withSessionPlace(snapshot.view, session.id)
    return {
      ...snapshot,
      view,
      sessions: orderSessions(sessions, view),
      history: others(snapshot.history),
      activeSessionId: snapshot.activeSessionId ?? session.id,
    }
  }
  const active =
    snapshot.activeSessionId === session.id
      ? neighbour(snapshot.sessions, session.id)
      : snapshot.activeSessionId
  return {
    ...snapshot,
    sessions: others(snapshot.sessions),
    history: [...others(snapshot.history), session].sort(lastClosedFirst),
    activeSessionId: active,
    view: snapshot.view && viewWithout(snapshot.view, session.id, active),
    overlay:
      snapshot.overlay.kind !== 'none' &&
      'sessionId' in snapshot.overlay &&
      snapshot.overlay.sessionId === session.id
        ? { kind: 'none' }
        : snapshot.overlay,
  }
}

/** Sorts a history list, the last closed first. */
export function sortHistory(history: readonly Session[]): Session[] {
  return [...history].sort(lastClosedFirst)
}
