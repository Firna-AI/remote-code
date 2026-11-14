import type { Session } from '../../shared/generated/Session'
import type { SessionsResponse } from '../../shared/sessions'
import type { ChatSnapshot } from './chat-snapshot'
import { withTranscript, type ChatContext } from './context'
import { applyMoves, claimMoves, saveMovedView } from './model-moves'
import type { ChatEnvelope } from '../../shared/transcript/session-events'
import {
  SessionLog,
  type PlacedRecord,
} from '../../shared/transcript/session-log'
import {
  orderSessions,
  pickActive,
  placeSession,
  sortHistory,
} from './sessions'
import { withSessionPlaces } from './tab-order'

/**
 * The order of the session records that a reply and the stream both write. Each
 * reply, read, and event carries the workspace event number of its state,
 * so the newest number wins, whatever arrives first. The session log of
 * each session keeps its newest record, as `SessionLog.record` says.
 *
 * A rename or a model change of the same agent shows at once as a pending
 * edit over the newest record. A confirmed edit retires itself and older
 * edits of its field. A failed edit retires only itself. Other edits stay.
 * The owner alone writes session logs and publishes their newest records.
 */

const logs = new WeakMap<ChatContext, Map<string, SessionLog>>()

function writableLogOf(context: ChatContext, sessionId: string): SessionLog {
  let own = logs.get(context)
  if (!own) {
    own = new Map()
    logs.set(context, own)
  }
  let log = own.get(sessionId)
  if (!log) {
    log = new SessionLog()
    own.set(sessionId, log)
  }
  return log
}

/** Read access to one session's log. Its writes stay with this owner. */
function logOf(
  context: ChatContext,
  sessionId: string,
): Pick<SessionLog, 'record' | 'transcript' | 'times'> {
  return writableLogOf(context, sessionId)
}

/** A change of a session record that waits for its reply. */
export interface PendingEdit {
  readonly change: Partial<Pick<Session, 'title' | 'choice'>>
}

/** The record of a session that the chat shows: the newest, with its edits. */
function shownRecord(context: ChatContext, sessionId: string): Session | null {
  const newest = logOf(context, sessionId).record?.session ?? null
  if (newest === null) return null
  const edits = context.edits.get(sessionId) ?? []
  return edits.reduce<Session>(
    (record, edit) => ({ ...record, ...edit.change }),
    newest,
  )
}

/** The snapshot with the shown record of a session in its place. */
function placeShown(
  context: ChatContext,
  snapshot: ChatSnapshot,
  sessionId: string,
): ChatSnapshot {
  const record = shownRecord(context, sessionId)
  return record === null ? snapshot : placeSession(snapshot, record)
}

/** The snapshot with the shown record of a session and its transcript. */
function withRecord(
  context: ChatContext,
  snapshot: ChatSnapshot,
  sessionId: string,
): ChatSnapshot {
  const log = logOf(context, sessionId)
  return withTranscript(
    placeShown(context, snapshot, sessionId),
    sessionId,
    log.transcript,
    log.times,
  )
}

/**
 * Takes a session record of a reply or a read, with the event number of its
 * state. It shows when it is the newest record of its session. Says whether
 * it counted.
 */
export function confirmRecord(
  context: ChatContext,
  session: Session,
  eventNumber: number,
): boolean {
  if (!context.live()) return false
  if (!writableLogOf(context, session.id).offer(session, eventNumber))
    return false
  const moves = claimMoves(context, [session])
  context.store.update((snapshot) =>
    applyMoves(withRecord(context, snapshot, session.id), moves),
  )
  saveMovedView(context, moves)
  return true
}

/**
 * Accepts a complete current list before publishing its records and selection.
 * The snapshot change supplies the initial view or the load's ready state.
 */
export function confirmSessions(
  context: ChatContext,
  response: SessionsResponse,
  change: (snapshot: ChatSnapshot) => ChatSnapshot,
): void {
  if (!context.live()) return
  const listed = [...response.sessions, ...response.history]
  const accepted: Session[] = []
  for (const session of listed) {
    if (
      writableLogOf(context, session.id).offer(session, response.eventNumber)
    ) {
      accepted.push(session)
    }
  }
  const moves = claimMoves(context, accepted)
  context.store.update((snapshot) => {
    const current = change(snapshot)
    const records = listed.map((item) => shownRecord(context, item.id) ?? item)
    const openRecords = records.filter((item) => item.closedAt === null)
    // The complete list gives each open session a place in the saved order,
    // and drops the places of sessions that are not open.
    const view = withSessionPlaces(current.view, openRecords)
    const open = orderSessions(openRecords, view)
    const shown = open.some((item) => item.id === current.activeSessionId)
    let next: ChatSnapshot = {
      ...current,
      view,
      sessions: open,
      history: sortHistory(records.filter((item) => item.closedAt !== null)),
      activeSessionId: shown ? current.activeSessionId : pickActive(open, view),
    }
    for (const { id } of listed) {
      const log = logOf(context, id)
      next = withTranscript(next, id, log.transcript, log.times)
    }
    for (const session of accepted) next = placeShown(context, next, session.id)
    return applyMoves(next, moves)
  })
  saveMovedView(context, moves)
}

/**
 * Merges a session's events and gives their snapshot change. A repeated or
 * older record changes no tabs, so local tabs of an archived reader stay.
 */
export function mergeSession(
  context: ChatContext,
  sessionId: string,
  events: readonly ChatEnvelope[],
): {
  record: PlacedRecord | null
  apply: (snapshot: ChatSnapshot) => ChatSnapshot
} {
  const log = writableLogOf(context, sessionId)
  const before = log.record
  const changed = log.merge(events)
  const record = log.record !== before ? log.record : null
  return {
    record,
    apply: (snapshot) =>
      !changed
        ? snapshot
        : withTranscript(
            record ? placeShown(context, snapshot, sessionId) : snapshot,
            sessionId,
            log.transcript,
            log.times,
          ),
  }
}

/** Shows a pending edit and gives separate confirmation and failure steps. */
export function beginEdit(
  context: ChatContext,
  sessionId: string,
  change: PendingEdit['change'],
): {
  confirm: (session: Session, eventNumber: number) => void
  fail: () => void
} {
  const edit: PendingEdit = { change }
  context.edits.set(sessionId, [...(context.edits.get(sessionId) ?? []), edit])
  context.store.update((snapshot) => placeShown(context, snapshot, sessionId))
  const retire = (confirmed: boolean) => {
    const pending = context.edits.get(sessionId) ?? []
    const at = pending.indexOf(edit)
    if (at < 0) return false
    const rest = pending.filter(
      (item, index) =>
        item !== edit &&
        (!confirmed ||
          index > at ||
          !Object.keys(change).some((field) => field in item.change)),
    )
    if (rest.length > 0) context.edits.set(sessionId, rest)
    else context.edits.delete(sessionId)
    return true
  }
  return {
    confirm: (session, eventNumber) => {
      if (!context.live()) return
      const changed = writableLogOf(context, sessionId).offer(
        session,
        eventNumber,
      )
      const retired = retire(true)
      if (changed || retired) {
        context.store.update((snapshot) =>
          withRecord(context, snapshot, sessionId),
        )
      }
    },
    fail: () => {
      const retired = retire(false)
      if (!context.live() || !retired) return
      context.store.update((snapshot) =>
        placeShown(context, snapshot, sessionId),
      )
    },
  }
}
