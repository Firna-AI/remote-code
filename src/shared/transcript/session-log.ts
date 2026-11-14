import type { Session } from '../generated/Session'

import type { ChatEnvelope } from './session-events'
import { emptyTranscript, foldEvent, type Transcript } from './transcript'
import { foldRecord } from './turn-records'

/** A record of the session, and the event number whose state it holds. */
export interface PlacedRecord {
  eventNumber: number
  session: Session
}

/** One step of the fold: an event, or a record from a read or a reply. */
type Entry =
  | { kind: 'event'; envelope: ChatEnvelope }
  | { kind: 'record'; record: PlacedRecord }

const numberOf = (entry: Entry) =>
  entry.kind === 'event' ? entry.envelope.eventNumber : entry.record.eventNumber

/** A record holds the state after its number, so it follows that event. */
const byOrder = (left: Entry, right: Entry) =>
  numberOf(left) - numberOf(right) ||
  (left.kind === right.kind ? 0 : left.kind === 'event' ? -1 : 1)

/**
 * The stored and live events of one session, and its records, in event
 * order. The numbers belong to this session's log only, so a history that
 * loads after the workspace stream moved on still applies in full. Each
 * number applies once, and an older event folds the transcript again in
 * order, when the transcript is next read. The log also keeps the time of
 * the first event of each item, so a part that is not an event, such as a
 * Mac command, can take its place among them.
 *
 * Each record folds at its place in the order: a `session.updated` event,
 * and a record that a read or a reply gives with its event number. So a
 * record that arrives late, such as in a history load, never brings back an
 * older Try again or running turn, or hides a newer one. `record` gives the
 * newest record of the session.
 */
export class SessionLog {
  private readonly entries: Entry[] = []
  private readonly numbers = new Set<number>()
  private newest: PlacedRecord | null = null
  private folded: Transcript = emptyTranscript
  private firstTimes: ReadonlyMap<string, number> = new Map()
  /** An entry came before the end of the fold, so the fold runs again. */
  private stale = false

  get transcript(): Transcript {
    this.refold()
    return this.folded
  }

  /** The time of the first event of each item of the transcript, by its ID. */
  get times(): ReadonlyMap<string, number> {
    this.refold()
    return this.firstTimes
  }

  /** The newest record of the session by event number, or null. */
  get record(): PlacedRecord | null {
    return this.newest
  }

  /** Adds the events that are new, and says whether there were any. */
  merge(envelopes: readonly ChatEnvelope[]): boolean {
    const fresh: Entry[] = []
    for (const envelope of envelopes) {
      const { eventNumber, event } = envelope
      if (this.numbers.has(eventNumber)) continue
      this.numbers.add(eventNumber)
      fresh.push({ kind: 'event', envelope })
      if (event.type !== 'session.updated') continue
      if (this.newest === null || eventNumber > this.newest.eventNumber) {
        this.newest = { eventNumber, session: event.session }
      }
    }
    this.add(fresh)
    return fresh.length > 0
  }

  /**
   * Takes a record that a read or a reply gives, with the event number of
   * its state. Only a record newer than each record of the log counts. Says
   * whether it counted.
   */
  offer(session: Session, eventNumber: number): boolean {
    if (this.newest !== null && this.newest.eventNumber >= eventNumber) {
      return false
    }
    const record = { eventNumber, session }
    this.newest = record
    this.add([{ kind: 'record', record }])
    return true
  }

  private add(fresh: Entry[]): void {
    if (fresh.length === 0) return
    fresh.sort(byOrder)
    const last = this.entries.at(-1)
    const appends = last === undefined || byOrder(last, fresh[0]) < 0
    this.entries.push(...fresh)
    if (!appends) {
      this.entries.sort(byOrder)
      this.stale = true
    }
    if (this.stale) return
    const folded = fold(this.folded, fresh, this.firstTimes)
    this.folded = folded.transcript
    this.firstTimes = folded.times
  }

  private refold(): void {
    if (!this.stale) return
    this.stale = false
    const folded = fold(emptyTranscript, this.entries, new Map())
    this.folded = folded.transcript
    this.firstTimes = folded.times
  }
}

/**
 * Folds entries in order, and notes the time of each item that an event
 * adds. The map of times is copied only when an event adds an item.
 */
function fold(
  start: Transcript,
  entries: readonly Entry[],
  known: ReadonlyMap<string, number>,
): { transcript: Transcript; times: ReadonlyMap<string, number> } {
  let transcript = start
  let times = known
  let copy: Map<string, number> | null = null
  for (const entry of entries) {
    if (entry.kind === 'record') {
      transcript = foldRecord(transcript, entry.record.session)
      continue
    }
    const { event, occurredAt, late } = entry.envelope
    const next = foldEvent(transcript, event, occurredAt, late)
    if (next.items.length > transcript.items.length) {
      for (const item of next.items) {
        if (times.has(item.id)) continue
        copy ??= new Map(times)
        copy.set(item.id, occurredAt)
        times = copy
      }
    }
    transcript = next
  }
  return { transcript, times }
}
