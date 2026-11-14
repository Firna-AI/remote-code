import type { DeviceCommandRecord } from '../../shared/generated/DeviceCommandRecord'
import type { ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'

import { Notice } from '../../../docs/mockups/src/components/common/Notice'
import type { TranscriptInsert } from '../../shared/transcript/transcript-entries'
import type { ChatSnapshot, SessionState } from '../state/chat-snapshot'
import { ActionButton } from '../ui/actions'
import { CommandCard } from './CommandCard'
import { requestsOf } from './device-snapshot'
import { placeCommands } from '../../shared/transcript/command-placement'

/**
 * The Mac commands of the shown session. The requests that wait go just
 * above the composer. Each other request is a card at its place in its
 * turn, so a request that gets its answer stays in the chat. The requests
 * of other sessions never show here.
 */
export function sessionCommands(
  snapshot: ChatSnapshot,
  sessionId: string | null,
  state: SessionState,
): { waiting: DeviceCommandRecord[]; inserts: TranscriptInsert<ReactNode>[] } {
  const viewerId = snapshot.account?.user.id ?? null
  const requests = requestsOf(snapshot.devices, sessionId)
  const answered = requests.filter((request) => request.state !== 'waiting')
  const placed = placeCommands(state.transcript.items, state.times, answered)
  return {
    waiting: requests.filter((request) => request.state === 'waiting'),
    inserts: placed.map(({ request, after }) => ({
      key: `command:${request.requestId}`,
      after,
      content: <CommandCard request={request} viewerId={viewerId} />,
    })),
  }
}

/** The Mac commands did not load. The chat keeps what it showed before. */
export function DeviceLoadNotice(props: { onRetry: () => void }) {
  return (
    <Notice
      action={<ActionButton onPress={props.onRetry}>Try again</ActionButton>}
      icon={CircleAlert}
      title="Mac commands did not load"
      tone="danger"
    />
  )
}
