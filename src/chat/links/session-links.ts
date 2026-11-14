import type { Session } from '../../shared/generated/Session'
import type { Workspace } from '../../shared/generated/Workspace'
import { useEffect } from 'react'
import type { ChipSession } from '../../../docs/mockups/src/components/chat/SessionChip'
import { workspaceLabel } from '../../../docs/mockups/src/components/workspaces/label'
import { nameLabel } from '../../shared/name-label'

import { useChatLinks } from './LinksContext'
import type { LinkedSessions, SessionReads } from './session-reads'
import type { LinkTarget } from './workspace-links'

/** The sessions that session chips find, as `sessionLinks` gives them. */
export interface SessionLinks {
  /** The session that a link names, as the reader knows it now, or null. */
  find: (workspaceId: string, sessionId: string) => Session | null
  /** Asks for the sessions of a workspace that the reader does not hold. */
  need: (workspaceId: string) => void
}

/**
 * The sessions that the chips of a chat or of New workspace find: the live
 * sessions of the workspace of the chat, open and closed, and for any other
 * workspace the sessions of its one read. `own` is null in New workspace.
 */
export function sessionLinks(
  own: { workspaceId: string; sessions: readonly Session[] } | null,
  reads: SessionReads,
  read: Readonly<Record<string, LinkedSessions>>,
): SessionLinks {
  const ownId = own?.workspaceId ?? null
  const listOf = (workspaceId: string): readonly Session[] => {
    if (workspaceId === ownId) return own?.sessions ?? []
    const linked = Object.hasOwn(read, workspaceId) ? read[workspaceId] : null
    return linked?.state === 'ready' ? linked.sessions : []
  }
  return {
    find: (workspaceId, sessionId) =>
      listOf(workspaceId).find((item) => item.id === sessionId) ?? null,
    need: (workspaceId) => {
      if (workspaceId !== ownId) reads.need(workspaceId)
    },
  }
}

/**
 * The session that a session link names, or null. Null also covers a link
 * to another page, a read that runs or failed, and a session that its
 * workspace does not hold, so the link keeps the chip of its workspace.
 * After the render, it asks for the one read of another workspace.
 */
export function useLinkedSession(
  target: LinkTarget | undefined,
): Session | null {
  const { sessions } = useChatLinks()
  const workspaceId = target?.workspace.id
  const sessionId = target?.sessionId ?? null
  const need = sessions?.need
  useEffect(() => {
    if (need && workspaceId !== undefined && sessionId !== null) {
      need(workspaceId)
    }
  }, [need, workspaceId, sessionId])
  if (!sessions || workspaceId === undefined || sessionId === null) return null
  return sessions.find(workspaceId, sessionId)
}

/** What a session chip shows: its workspace now, and the session title. */
export function sessionChipOf(
  workspace: Workspace,
  session: Session,
): ChipSession {
  return {
    workspace: {
      label: workspaceLabel(workspace.number),
      status: workspace.state,
      github: workspace.github,
    },
    title: nameLabel(session.title),
  }
}
