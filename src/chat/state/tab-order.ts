import type { Session } from '../../shared/generated/Session'

import type {
  TemporaryTab,
  WorkspaceTab,
  WorkspaceView,
} from '../../shared/workspace-view'

export type TabPlace = { before: WorkspaceTab } | { after: WorkspaceTab }

/**
 * The key of a tab, or of the mark of the temporary tab. One file or diff
 * keeps its identity when its display mode changes, so the mark, which
 * names no mode, has the key of its tab.
 */
export function tabKey(tab: WorkspaceTab | TemporaryTab): string {
  return tab.kind === 'session'
    ? `session:${tab.sessionId}`
    : `${tab.kind}:${tab.path}`
}

/** The visible saved tabs, then the sessions that have no saved place. */
export function rowTabs(
  view: WorkspaceView | null,
  sessions: readonly Session[],
  files: boolean,
): WorkspaceTab[] {
  const open = new Set(sessions.map((session) => session.id))
  const seen = new Set<string>()
  const tabs: WorkspaceTab[] = []
  const append = (tab: WorkspaceTab) => {
    const key = tabKey(tab)
    if (seen.has(key)) return
    seen.add(key)
    tabs.push(tab)
  }
  for (const tab of view?.tabs ?? []) {
    if (tab.kind === 'session' ? open.has(tab.sessionId) : files) append(tab)
  }
  for (const { id } of sessions) append({ kind: 'session', sessionId: id })
  return tabs
}

/** Adds one arriving session's missing place without removing any other place. */
export function withSessionPlace(
  view: WorkspaceView | null,
  sessionId: string,
): WorkspaceView | null {
  if (
    view === null ||
    view.tabs.some(
      (tab) => tab.kind === 'session' && tab.sessionId === sessionId,
    )
  )
    return view
  return { ...view, tabs: [...view.tabs, { kind: 'session', sessionId }] }
}

/** Keeps one place per open session, and appends missing places in creation order. */
export function withSessionPlaces(
  view: WorkspaceView | null,
  open: readonly Session[],
): WorkspaceView | null {
  if (view === null) return null
  const ids = new Set(open.map((session) => session.id))
  const placed = new Set<string>()
  const tabs = view.tabs.filter((tab) => {
    if (tab.kind !== 'session') return true
    if (!ids.has(tab.sessionId) || placed.has(tab.sessionId)) return false
    placed.add(tab.sessionId)
    return true
  })
  for (const session of [...open].sort((a, b) => a.createdAt - b.createdAt)) {
    if (placed.has(session.id)) continue
    tabs.push({ kind: 'session', sessionId: session.id })
    placed.add(session.id)
  }
  return sameOrder(tabs, view.tabs) ? view : { ...view, tabs }
}

function sameOrder(
  left: readonly WorkspaceTab[],
  right: readonly WorkspaceTab[],
): boolean {
  return (
    left.length === right.length && left.every((tab, i) => tab === right[i])
  )
}

/**
 * Moves one tab beside a visible neighbour, and keeps the other tabs in
 * place. A move that changes the place of the temporary tab keeps it: the
 * view drops its mark with the new order. The drop of a drag, Move left,
 * and Move right all move through here. A move that changes no place gives
 * the same view object, so the mark stays and nothing saves.
 */
export function moveTab(
  view: WorkspaceView,
  row: readonly WorkspaceTab[],
  tab: WorkspaceTab,
  place: TabPlace,
): WorkspaceView {
  const key = tabKey(tab)
  const neighbour = tabKey('before' in place ? place.before : place.after)
  const visible = new Set(row.map(tabKey))
  if (key === neighbour || !visible.has(key) || !visible.has(neighbour)) {
    return view
  }
  const moving = view.tabs.find((item) => tabKey(item) === key)
  if (!moving) return view
  const tabs = view.tabs.filter((item) => tabKey(item) !== key)
  const at = tabs.findIndex((item) => tabKey(item) === neighbour)
  if (at < 0) return view
  tabs.splice(at + ('after' in place ? 1 : 0), 0, moving)
  if (sameOrder(tabs, view.tabs)) return view
  const mark = view.temporaryTab
  const kept = mark !== null && tabKey(mark) === key
  return { ...view, tabs, temporaryTab: kept ? null : mark }
}
