import type { AgentModel } from '../generated/AgentModel'
import type { DeviceCommandRecord } from '../generated/DeviceCommandRecord'
import type { Session } from '../generated/Session'
import type { TranscriptDetail } from '../generated/TranscriptDetail'
import type { Workspace } from '../generated/Workspace'
import type { AgentChoice } from '../generated/AgentChoice'
import { effortLabels, modelLabel } from '../agents'

import { nameLabel } from '../name-label'

import { placeCommands } from './command-placement'
import { turnOf } from './known-turns'
import {
  commandMarkdown,
  foldMarkdown,
  itemMarkdown,
  toolMarkdown,
} from './markdown-items'
import { plainText } from './markdown-code'
import { chatEventsOf, type SessionEnvelopeInput } from './session-events'
import { SessionLog } from './session-log'
import { groupEntries, workSummary } from './transcript-entries'
import { turnCopy, type ChatReaders } from './turn-words'

export interface TranscriptDocument {
  linkContext: { origin: string; orgId: string }
  session: Session
  eventNumber: number
  workspace: Pick<Workspace, 'number' | 'name' | 'link'>
  copiedAt: number
  models: readonly AgentModel[]
  members: ChatReaders['members']
  commands: readonly DeviceCommandRecord[]
  sourceTitle?: string | null
}

function copiedTime(timestamp: number): string {
  const day = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(timestamp)
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }).format(timestamp)
  return `Copied ${day}, ${time} UTC`
}

/** One session's stored history, folded with the same rules as browser chat. */
export class SessionMarkdown {
  private readonly document: TranscriptDocument
  private readonly log = new SessionLog()
  private readonly choices = new Map<
    string,
    { number: number; choice: AgentChoice }
  >()

  constructor(document: TranscriptDocument) {
    this.document = document
    this.log.offer(document.session, document.eventNumber)
  }

  merge(events: readonly SessionEnvelopeInput[]): void {
    const own = chatEventsOf(this.document.session.id, events)
    this.log.merge(own)
    for (const { event, eventNumber } of own) {
      if (event.type !== 'turn.started') continue
      const previous = this.choices.get(event.turnId)
      if (!previous || previous.number < eventNumber) {
        this.choices.set(event.turnId, {
          number: eventNumber,
          choice: event.choice,
        })
      }
    }
  }

  private agentHeading(turnId: string | null): string {
    const { session, models } = this.document
    const transcript = this.log.transcript
    const ids =
      transcript.turns.find((turn) => turn.id === turnId)?.messageIds ?? []
    const first = transcript.items.find(
      (item) => item.kind === 'user' && ids.includes(item.message.id),
    )
    const choice =
      (turnId === null ? undefined : this.choices.get(turnId)?.choice) ??
      (first?.kind === 'user' ? first.message.choice : session.choice)
    return `## Agent · ${plainText(modelLabel(models, choice))} ${effortLabels[choice.effort]}`
  }

  render(detail: TranscriptDetail): string {
    const { session, workspace, commands, members } = this.document
    const transcript = this.log.transcript
    const readers = { viewerId: null, members }
    const own = commands.filter((request) => request.sessionId === session.id)
    const placed = placeCommands(
      transcript.items,
      this.log.times,
      own.filter((request) => request.state !== 'waiting'),
    )
    const inserts = placed.map(({ request, after }) => ({
      key: `command:${request.requestId}`,
      after,
      content: request,
    }))
    const blocks = [
      `# ${plainText(nameLabel(session.title))}`,
      `W-${workspace.number} · ${plainText(nameLabel(workspace.name))} · ${workspace.link}\n${copiedTime(this.document.copiedAt)}`,
    ]
    if (session.sourceSessionId && this.document.sourceTitle !== undefined) {
      blocks.push(
        `${turnCopy.source} ${plainText(nameLabel(this.document.sourceTitle))}`,
      )
    }
    let headed: string | null | undefined
    const heading = (turnId: string | null) => {
      if (headed === turnId) return
      blocks.push(this.agentHeading(turnId))
      headed = turnId
    }
    for (const entry of groupEntries(transcript, inserts)) {
      if (entry.kind === 'item' && entry.item.kind === 'user') {
        const { sender } = entry.item.message
        blocks.push(
          `## ${plainText(sender.displayName ?? sender.githubLogin)}`,
          itemMarkdown(
            entry.item,
            transcript,
            readers,
            this.document.linkContext,
          ),
        )
        headed = undefined
        continue
      }
      if (entry.kind === 'item') {
        // The note of a Continue belongs to no turn, so it has no heading.
        if (entry.item.kind !== 'continued') {
          heading(turnOf(transcript, entry.item))
        }
        blocks.push(
          itemMarkdown(
            entry.item,
            transcript,
            readers,
            this.document.linkContext,
          ),
        )
      } else if (entry.kind === 'insert') {
        heading(entry.insert.content.turnId)
        blocks.push(commandMarkdown(entry.insert.content))
      } else if (entry.kind === 'tools') {
        const first = transcript.items.find((item) => item.id === entry.id)
        heading(first ? turnOf(transcript, first) : null)
        blocks.push(
          detail === 'concise' && !entry.open
            ? foldMarkdown(entry.calls)
            : entry.calls.map(toolMarkdown).join('\n'),
        )
      } else {
        const first = entry.steps[0]
        heading(
          first.kind === 'item'
            ? turnOf(transcript, first.item)
            : first.insert.content.turnId,
        )
        if (detail === 'concise') {
          const { calls, messages } = workSummary(entry.steps)
          blocks.push(foldMarkdown(calls, messages))
        } else {
          blocks.push(
            ...entry.steps.map((step) =>
              step.kind === 'item'
                ? itemMarkdown(
                    step.item,
                    transcript,
                    readers,
                    this.document.linkContext,
                  )
                : commandMarkdown(step.insert.content),
            ),
          )
        }
      }
    }
    if (transcript.turn) {
      heading(transcript.turn.turnId)
      blocks.push(`_${turnCopy.stillWorking}_`)
    }
    blocks.push(
      ...own
        .filter((request) => request.state === 'waiting')
        .map(commandMarkdown),
    )
    return blocks.filter((block) => block.length > 0).join('\n\n') + '\n'
  }
}
