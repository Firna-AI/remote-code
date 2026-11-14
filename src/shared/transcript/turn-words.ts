import type { TurnEndReason } from '../generated/TurnEndReason'
import type { MessageSender } from '../generated/MessageSender'
import {
  memberStopped,
  stoppedUnnamed,
  stoppedFrom,
} from '../../../docs/mockups/src/components/chat/stopCopy'
import type { StopSessionReference } from '../session-stop'
import type { User } from '../api'
import {
  turnFilesUnavailable,
  unlistedFiles,
} from '../../../docs/mockups/src/components/chat/lostCopy'
import {
  knownSpeedCause,
  standardSpeedText,
  type StandardSpeedCause,
} from '../../../docs/mockups/src/components/chat/speedCopy'
import type { Transcript } from './transcript'

export const turnCopy = {
  failed: 'This turn stopped',
  finished: 'Finished in',
  changedFiles: 'Changed files',
  stillWorking: 'The agent is still working.',
  attachments: 'Attachments',
  source: 'This session started from',
  retry: 'Try again',
  files: 'Files this turn changed',
  working: 'Working',
  thinking: 'Thinking',
} as const

/** The person who reads the chat, and the members whom it can name. */
export interface ChatReaders {
  viewerId: string | null
  members: readonly Pick<User, 'id' | 'githubLogin' | 'displayName'>[]
}

/**
 * The line of a stopped turn: "You" to the member who pressed Stop, and
 * that member's name to the others. An unnamed stop names nobody.
 */
function stoppedLine(by: string | null, readers: ChatReaders): string {
  if (by !== null && by === readers.viewerId) return memberStopped('You')
  const member = readers.members.find((item) => item.id === by)
  if (!member) return stoppedUnnamed
  return memberStopped(member.displayName ?? member.githubLogin)
}

/**
 * Who pressed Continue: "You" to that member, and the name that the note
 * keeps of the member to the others, also after the member left the org. A
 * copy has no reader, so it always gives the name.
 */
export function continuedBy(
  member: MessageSender,
  readers: ChatReaders,
): string {
  if (member.id === readers.viewerId) return 'You'
  return member.displayName ?? member.githubLogin
}

/** The newest end of a turn, with the data that its rows do not keep. */
function completionOf(transcript: Transcript, turnId: string) {
  const { turnCompletions } = transcript
  return Object.hasOwn(turnCompletions, turnId)
    ? turnCompletions[turnId]
    : undefined
}

/** The files of an ended turn past the ones that the runner listed. */
export function omittedFiles(transcript: Transcript, turnId: string): number {
  return completionOf(transcript, turnId)?.omittedFileCount ?? 0
}

/** Whether the cloud computer could not read the changed files of a turn. */
export function filesUnread(transcript: Transcript, turnId: string): boolean {
  return completionOf(transcript, turnId)?.filesUnavailable === true
}

/** The cause that finished a turn, when its end names one. */
export function turnEndReason(
  transcript: Transcript,
  turnId: string,
): TurnEndReason | undefined {
  return completionOf(transcript, turnId)?.endReason
}

/**
 * The standard speed of a fast turn that ran at standard speed, with the
 * cause that its line can name. A turn at fast speed, and a turn without
 * fast mode, have none. An unknown cause gives a speed without a cause, so
 * the line says "Standard speed" alone.
 */
export function standardSpeedOf(
  transcript: Transcript,
  turnId: string,
): { cause?: StandardSpeedCause } | undefined {
  const speed = completionOf(transcript, turnId)?.speed
  if (speed?.state !== 'standard') return undefined
  const cause = knownSpeedCause(speed.cause)
  return cause === undefined ? {} : { cause }
}

/** The words of the standard speed of a turn, if it has one. */
export function standardSpeedLine(
  transcript: Transcript,
  turnId: string,
): string | undefined {
  const speed = standardSpeedOf(transcript, turnId)
  return speed && standardSpeedText(speed.cause)
}

/** Whether a turn has a file row, such as one from a late end. */
function hasFileRow(transcript: Transcript, turnId: string): boolean {
  return transcript.items.some(
    (item) => item.kind === 'turn-end' && item.turnId === turnId,
  )
}

export function stoppedAttribution(
  transcript: Transcript,
  turnId: string,
  by: string | null,
  readers: ChatReaders,
):
  | { kind: 'session'; text: string; reference: StopSessionReference }
  | { kind: 'text'; text: string } {
  const stopped = transcript.items.find(
    (item) => item.kind === 'stopped' && item.turnId === turnId,
  )
  return stopped?.kind === 'stopped' && stopped.from
    ? { kind: 'session', text: stoppedFrom, reference: stopped.from }
    : { kind: 'text', text: stoppedLine(by, readers) }
}

/**
 * The notes of the line of a stopped turn: its standard speed, then its
 * files that the line does not list. A file row of the turn, such as one
 * from a late end, shows these instead, beside its duration.
 */
export function stoppedNotes(transcript: Transcript, turnId: string): string[] {
  if (hasFileRow(transcript, turnId)) return []
  const speed = standardSpeedLine(transcript, turnId)
  const files = omittedFiles(transcript, turnId)
  return [
    ...(speed === undefined ? [] : [speed]),
    ...(files > 0 ? [unlistedFiles(files)] : []),
    ...(filesUnread(transcript, turnId) ? [turnFilesUnavailable] : []),
  ]
}

export function stoppedSummary(
  transcript: Transcript,
  turnId: string,
  by: string | null,
  readers: ChatReaders,
): string {
  const source = stoppedAttribution(transcript, turnId, by, readers)
  return [
    source.kind === 'text' ? source.text : stoppedUnnamed,
    ...stoppedNotes(transcript, turnId),
  ].join(' · ')
}
