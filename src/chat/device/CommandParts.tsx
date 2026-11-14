import type { DeviceCommandRecord } from '../../shared/generated/DeviceCommandRecord'
import { ChevronDown } from 'lucide-react'

import { nameLabel } from '../../shared/name-label'
import { StatusText } from '../../../docs/mockups/src/components/common/StatusText'
import card from '../../../docs/mockups/src/components/chat/MacCommand.module.css'
import styles from '../../../docs/mockups/src/components/chat/PendingCommand.module.css'
import {
  commandCopy,
  limitLabel,
  longerReason,
  personName,
} from '../../shared/transcript/command-words'
import { statePresentation } from './command-text'
import { LiteralText } from './LiteralText'

/**
 * The exact command, after a muted shell prompt, with its line breaks,
 * tabs, repeated spaces, and a mark for each hidden character. A long
 * command wraps.
 */
export function CommandLine(props: { command: string }) {
  return (
    <LiteralText
      className={card.command}
      lead={
        <span aria-hidden className={card.prompt}>
          ${' '}
        </span>
      }
      syntax="shell"
      text={props.command}
    />
  )
}

/** The state of a request, as a glyph and a word. */
export function CommandStatus(props: { request: DeviceCommandRecord }) {
  const presentation = statePresentation(props.request)
  return (
    <StatusText
      busy={presentation.busy}
      icon={presentation.icon}
      label={presentation.label}
      tone={presentation.tone}
    />
  )
}

/** The people and the org that the facts of a request name. */
export interface RequestReaders {
  viewerId: string | null
  orgName: string | null
}

function factsOf(request: DeviceCommandRecord, readers: RequestReaders) {
  const sender = personName(request.sender)
  const workspace = readers.orgName
    ? `${nameLabel(request.workspaceName)}, in ${readers.orgName}`
    : nameLabel(request.workspaceName)
  return [
    { term: 'Folder', value: request.folder, literal: true },
    { term: 'Reason', value: request.reason, literal: false },
    { term: 'Workspace', value: workspace, literal: false },
    {
      term: 'Sender',
      value:
        request.sender.id === readers.viewerId ? `${sender} (you)` : sender,
      literal: false,
    },
  ]
}

/**
 * The Mac and the time limit as a small label, and Details, which opens
 * the folder, the reason, the workspace, and the sender. The folder shows
 * as literal text, as the Mac uses it. The reason for a time limit above
 * 120 seconds shows without a click.
 */
export function RequestDetails(props: {
  request: DeviceCommandRecord
  mac: string
  readers: RequestReaders
}) {
  const { request } = props
  const why = longerReason(request)
  return (
    <details className={styles.details}>
      <summary className={styles.summary}>
        <span className={styles.meta}>
          <span>
            {props.mac} · {commandCopy.upTo}{' '}
            {limitLabel(request.timeoutSeconds)}
          </span>
          <span className={styles.toggle}>
            Details
            <ChevronDown aria-hidden className={styles.chevron} size={12} />
          </span>
        </span>
        {why ? (
          <span className={styles.why}>Longer than usual. {why}</span>
        ) : null}
      </summary>
      <dl className={styles.facts}>
        {factsOf(request, props.readers).map((fact) => (
          <div className={styles.fact} key={fact.term}>
            <dt className={styles.term}>{fact.term}</dt>
            <dd className={fact.literal ? styles.mono : styles.value}>
              {fact.literal ? (
                <LiteralText as="span" text={fact.value} />
              ) : (
                fact.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
