import type { Session } from '../../shared/generated/Session'
import type { ReactNode } from 'react'
import { LinkedLine } from '../../../docs/mockups/src/components/chat/LinkedLine'
import { nameLabel } from '../../shared/name-label'

import type { ChatSnapshot } from '../state/chat-snapshot'
import controls from '../ui/controls.module.css'
import type { TranscriptInsert } from '../../shared/transcript/transcript-entries'

/**
 * The first line of a linked session: it names the session that it started
 * from, or Untitled for a session with no title, as a link that opens that
 * session, also from the history. Without the record of that session, no
 * line shows.
 */
export function sourceInsert(
  snapshot: ChatSnapshot,
  session: Session | null,
  onOpen: (sessionId: string) => void,
): TranscriptInsert<ReactNode> | null {
  const sourceId = session?.sourceSessionId ?? null
  if (sourceId === null) return null
  const source = [...snapshot.sessions, ...snapshot.history].find(
    (item) => item.id === sourceId,
  )
  if (!source) return null
  return {
    key: 'source',
    after: null,
    content: (
      <LinkedLine
        link={
          <button
            className={controls.bare}
            onClick={() => onOpen(source.id)}
            type="button"
          >
            {nameLabel(source.title)}
          </button>
        }
      />
    ),
  }
}
