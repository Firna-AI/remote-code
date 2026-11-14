import type { Workspace } from '../../shared/generated/Workspace'
import { createContext, useContext, type ReactNode } from 'react'
import type { ChipWorkspace } from '../../../docs/mockups/src/components/chat/WorkspaceChip'
import { workspaceLabel } from '../../../docs/mockups/src/components/workspaces/label'
import { nameLabel } from '../../shared/name-label'

import type { SessionLinks } from './session-links'
import type { WorkspaceLinks } from './workspace-links'

/** The workspaces that chips find, and how a chip opens its page. */
export interface ChatLinks {
  links: WorkspaceLinks
  /**
   * Opens a page of the app, such as the page of a chip, in the same window.
   * Without it, a chip is a plain link that the browser opens.
   */
  open?: (to: string) => void
  /**
   * The sessions that session chips find. Without it, each session link
   * shows the chip of its workspace.
   */
  sessions?: SessionLinks
  /**
   * The origin of the links of the app, from the link of the chat's own
   * workspace. A session that the chat names by its IDs, such as the
   * session whose agent stopped a turn, shows its link with it when no
   * workspace of the list matches.
   */
  origin?: string
}

const LinksContext = createContext<ChatLinks>({
  links: { orgId: '', workspaces: null },
})

/** Gives each chip inside it the workspaces of the org and the way to open them. */
export function LinksProvider(props: {
  value: ChatLinks
  children: ReactNode
}) {
  return (
    <LinksContext.Provider value={props.value}>
      {props.children}
    </LinksContext.Provider>
  )
}

/** The workspaces that chips find. Outside a provider, no link is a chip. */
export function useChatLinks(): ChatLinks {
  return useContext(LinksContext)
}

/**
 * What a chip shows of its workspace now: the label, the name, the state,
 * and the GitHub state of its pull request.
 */
export function chipOf(workspace: Workspace): ChipWorkspace {
  return {
    label: workspaceLabel(workspace.number),
    name: nameLabel(workspace.name),
    status: workspace.state,
    github: workspace.github,
  }
}
