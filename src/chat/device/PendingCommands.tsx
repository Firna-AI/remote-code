import type { DeviceCommandRecord } from '../../shared/generated/DeviceCommandRecord'
import { Laptop } from 'lucide-react'
import type { DeviceApprovalAction } from '../../shared/device'
import pane from '../../../docs/mockups/src/components/chat/ChatPane.module.css'
import styles from '../../../docs/mockups/src/components/chat/PendingCommand.module.css'
import { macLabel } from '../../shared/transcript/command-words'
import { CommandChoices } from './CommandChoices'
import {
  CommandLine,
  CommandStatus,
  RequestDetails,
  type RequestReaders,
} from './CommandParts'
import { answerOf, canAnswer, type DeviceSnapshot } from './device-snapshot'

/**
 * A command that waits for its answer, as a compact message (decision 62):
 * the exact command, the Mac, the time limit, and Details. The Mac app on
 * the Mac that got the request shows Deny and Allow. Every other window
 * shows the state only, because only that Mac app can allow the command. A
 * read-only workspace takes no answer, so it shows the state only too.
 */
function PendingCommand(props: {
  request: DeviceCommandRecord
  devices: DeviceSnapshot
  readers: RequestReaders
  readOnly: boolean
  onAnswer: (requestId: string, action: DeviceApprovalAction) => void
}) {
  const { request, devices } = props
  const choices = !props.readOnly && canAnswer(devices, request)
  const mac = macLabel(request, choices)
  return (
    <section
      aria-label={choices ? 'Run a command on this Mac?' : `Command on ${mac}`}
      className={styles.pending}
    >
      <div className={styles.head}>
        <Laptop aria-hidden className={styles.icon} size={14} />
        <span className={styles.command}>
          <CommandLine command={request.command} />
        </span>
        <span className={styles.end}>
          {choices ? (
            <CommandChoices
              answering={answerOf(devices, request.requestId)}
              onAnswer={(action) => props.onAnswer(request.requestId, action)}
            />
          ) : (
            <CommandStatus request={request} />
          )}
        </span>
      </div>
      <RequestDetails mac={mac} readers={props.readers} request={request} />
    </section>
  )
}

/**
 * The requests of the session that wait for an answer, the oldest first,
 * just above the composer. Each one keeps its own choices, so every request
 * that waits has a way to answer it. A long command or many requests scroll
 * inside the region, so the composer stays in view.
 */
export function PendingCommands(props: {
  requests: readonly DeviceCommandRecord[]
  devices: DeviceSnapshot
  readers: RequestReaders
  /** The workspace takes no answer: it is archived, or its org is suspended. */
  readOnly?: boolean
  onAnswer: (requestId: string, action: DeviceApprovalAction) => void
}) {
  if (props.requests.length === 0) return null
  return (
    <div
      aria-label="Commands that wait for an answer"
      className={pane.requests}
      role="group"
    >
      {props.requests.map((request) => (
        <PendingCommand
          devices={props.devices}
          key={request.requestId}
          onAnswer={props.onAnswer}
          readOnly={props.readOnly ?? false}
          readers={props.readers}
          request={request}
        />
      ))}
    </div>
  )
}
