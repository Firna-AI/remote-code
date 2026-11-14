import type { DeviceCommandRecord } from '../generated/DeviceCommandRecord'
import type { ToolCall } from '../generated/ToolCall'
import type { ChangedFile } from '../generated/ChangedFile'
import type { UserMessage } from '../generated/UserMessage'
import { sessionLink } from '../session-link'

import { endReasonText } from '../../../docs/mockups/src/components/chat/endReasonCopy'
import {
  attachmentForMention,
  textWithAttachmentNames,
} from '../attachment-mentions'
import { mentionParts } from '../mention-text'
import {
  leftOutOfCall,
  leftOutOfRun,
  lostText,
  moreFiles,
  turnFilesUnavailable,
} from '../../../docs/mockups/src/components/chat/lostCopy'
import { continuedNote } from '../../../docs/mockups/src/components/workspace/barCopy'
import {
  commandCopy,
  commandRan,
  limitLabel,
  macName,
  outputOf,
  stateLabel,
  stateNote,
} from './command-words'
import { formatDuration } from './duration'
import { lostData } from './lost-data'
import { codeBlock, inlineCode, plainText } from './markdown-code'
import { foldLabel, toolEnding, toolVerb } from './tool-words'
import type { Transcript, TranscriptItem } from './transcript'
import {
  continuedBy,
  filesUnread,
  omittedFiles,
  standardSpeedLine,
  stoppedSummary,
  stoppedAttribution,
  stoppedNotes,
  turnCopy,
  turnEndReason,
  type ChatReaders,
} from './turn-words'

const note = (text: string) => `_${text}_`

export function toolMarkdown(call: ToolCall): string {
  return `- ${[
    `${toolVerb(call)} ${inlineCode(call.target.replace(/[\r\n]+/g, ' '))}`,
    ...(call.detail ? [plainText(call.detail)] : []),
    ...(call.omittedDetailBytes > 0
      ? [leftOutOfCall(call.omittedDetailBytes)]
      : []),
    ...(toolEnding(call) ? [toolEnding(call)] : []),
  ].join(' · ')}`
}

export function foldMarkdown(calls: readonly ToolCall[], messages = 0): string {
  const omitted = calls.reduce((sum, call) => sum + call.omittedDetailBytes, 0)
  return note(
    [
      foldLabel(calls.length, messages),
      ...(omitted > 0 ? [leftOutOfRun(omitted)] : []),
    ].join(' · '),
  )
}

function changedFile(file: ChangedFile): string {
  const current = inlineCode(file.displayPath ?? file.path)
  return file.previousPath === undefined
    ? current
    : `${inlineCode(file.previousDisplayPath ?? file.previousPath)} → ${current}`
}

function userMarkdown(message: UserMessage): string {
  const mentioned = new Set(
    mentionParts(message.text).flatMap((part) =>
      part.kind === 'mention'
        ? (attachmentForMention(part, message.attachments)?.id ?? [])
        : [],
    ),
  )
  const files = message.attachments.filter((file) => !mentioned.has(file.id))
  return [
    textWithAttachmentNames(message.text, message.attachments, plainText),
    ...(files.length > 0
      ? [
          `${turnCopy.attachments}: ${files.map((file) => plainText(file.name)).join(', ')}`,
        ]
      : []),
  ]
    .filter((part) => part.length > 0)
    .join('\n\n')
}

export function itemMarkdown(
  item: TranscriptItem,
  transcript: Transcript,
  readers: ChatReaders,
  links: { origin: string; orgId: string },
): string {
  switch (item.kind) {
    case 'user':
      return userMarkdown(item.message)
    case 'agent':
      return item.text
    case 'tool':
      return toolMarkdown(item.tool)
    case 'turn-end': {
      const reason = turnEndReason(transcript, item.turnId)
      const omitted = omittedFiles(transcript, item.turnId)
      const files = [
        ...item.files.map(changedFile),
        ...(omitted > 0 ? [moreFiles(omitted)] : []),
      ]
      const unread =
        item.files.length === 0 && filesUnread(transcript, item.turnId)
      // The standard speed follows the duration, which it explains, as the
      // note stands beside the duration in the chat.
      const speed = standardSpeedLine(transcript, item.turnId)
      const summary = note(
        `${turnCopy.finished} ${formatDuration(item.durationMs)}${speed === undefined ? '' : ` · ${speed}`}${files.length > 0 ? `. ${turnCopy.changedFiles}: ${files.join(' · ')}` : ''}${unread ? ` · ${turnFilesUnavailable}` : ''}`,
      )
      return [
        ...(reason === undefined ? [] : [note(endReasonText(reason))]),
        summary,
      ].join('\n\n')
    }
    case 'stopped': {
      const source = stoppedAttribution(
        transcript,
        item.turnId,
        item.by,
        readers,
      )
      return note(
        source.kind === 'session'
          ? [
              `${source.text} <${sessionLink(links.origin, links.orgId, source.reference.workspaceId, source.reference.sessionId)}>`,
              ...stoppedNotes(transcript, item.turnId).map(plainText),
            ].join(' · ')
          : plainText(
              stoppedSummary(transcript, item.turnId, item.by, readers),
            ),
      )
    }
    case 'failed':
      return note(`${turnCopy.failed}: ${plainText(item.error.message)}`)
    case 'lost':
      return note(
        lostText(lostData[item.marker.runnerEventType], item.marker.reason),
      )
    case 'continued': {
      // The words of the note of the chat, with each branch as code.
      const words = continuedNote(
        plainText(continuedBy(item.member, readers)),
        inlineCode(item.baseBranch),
      )
      return note(`${words.before}${inlineCode(item.branch)}${words.after}`)
    }
  }
}

export function commandMarkdown(request: DeviceCommandRecord): string {
  const output = outputOf(request)
  const state = stateNote(request, null)
  return [
    `Mac command · ${plainText(macName(request))} · ${stateLabel(request)}`,
    codeBlock(request.command, 'sh'),
    `${commandCopy.in} ${inlineCode(request.folder)} · ${commandCopy.upTo} ${limitLabel(request.timeoutSeconds)}`,
    ...(commandRan(request)
      ? [output === null ? commandCopy.empty : codeBlock(output)]
      : []),
    ...(request.result?.truncated ? [commandCopy.truncated] : []),
    ...(state ? [plainText(state)] : []),
  ].join('\n\n')
}
