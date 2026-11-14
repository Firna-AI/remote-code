import { CircleAlert, MessageSquarePlus, Plug, X } from 'lucide-react'
import type { Agent } from '../../shared/generated/Agent'
import {
  linkedReasonText,
  linkedTitle,
  type LinkedReason,
} from '../../../docs/mockups/src/components/chat/linkedCopy'
import { Notice } from '../../../docs/mockups/src/components/common/Notice'
import type { SendBlock } from '../state/blockers'
import type { ChatNotice } from '../state/chat-snapshot'
import { ActionButton, IconButton } from '../ui/actions'
import { agentNames } from './AgentMark'

/**
 * The notice over the composer when the agent is not connected.
 * Its action opens the Connect form of that agent.
 */
export function BlockNotice(props: {
  block: SendBlock
  model: string
  onConnectAgent?: (agent: Agent) => void
}) {
  const { block, onConnectAgent } = props
  const name = agentNames[block.agent]
  return (
    <Notice
      action={
        onConnectAgent ? (
          <ActionButton icon={Plug} onPress={() => onConnectAgent(block.agent)}>
            {`Connect ${name}`}
          </ActionButton>
        ) : undefined
      }
      icon={Plug}
      title={`Connect ${name} to use ${props.model}`}
    />
  )
}

/**
 * The notice over the composer when the login of the starter is not
 * available, or the starter keeps it for their own messages, so the message
 * starts a new session on the reader's own login. An older record names no
 * starter, so the notice names nobody.
 */
export function LinkedSessionNotice(props: {
  agent: Agent
  starter: string | null
  reason: LinkedReason
}) {
  const agent = agentNames[props.agent]
  return (
    <Notice
      body={linkedReasonText(props.reason, props.starter, agent)}
      icon={MessageSquarePlus}
      title={linkedTitle}
    />
  )
}

/** An action that failed, with the cause, until the user dismisses it. */
export function ActionNotice(props: {
  notice: ChatNotice
  onDismiss: () => void
}) {
  return (
    <Notice
      action={
        <IconButton icon={X} label="Dismiss" onPress={props.onDismiss} quiet />
      }
      body={props.notice.message}
      icon={CircleAlert}
      title={props.notice.title}
      tone="danger"
    />
  )
}
