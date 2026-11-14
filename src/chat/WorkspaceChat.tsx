import type { Workspace } from '../shared/generated/Workspace'
import {
  useCallback,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { Agent } from '../shared/generated/Agent'
import type { WorkspaceView } from '../shared/workspace-view'

import { TouchScreen } from '../../docs/mockups/src/components/common/touch'
import { useFollowTabs } from '../app/tab-places'
import {
  ChatDropAreaProvider,
  useChatDropArea,
} from './components/chat-drop-area'
import { ChatOverlays, historyEntries } from './components/ChatOverlays'
import type { ComposerFocus } from './components/Composer'
import { SessionChat, type ChatHost } from './components/SessionChat'
import { CodeCopyProvider, useCodeCopyAction } from './components/code-copy'
import { useSessionLinkCopy } from './components/session-link-copy'
import { SessionTabs } from './components/SessionTabs'
import { useTabKeys } from './components/tab-keys'
import { rowOf, shownTab, type RenderTab } from './components/tab-row'
import { ChatToasts, useTranscriptCopy } from './components/TranscriptCopy'
import { useChatLinksOf } from './links/chat-links'
import { LinksProvider } from './links/LinksContext'
import { useMentionCopy } from './links/mention-copy'
import { MentionsProvider, type ChatMentions } from './mentions/MentionsContext'
import { endedAt, historySessions, tabSessions } from './state/archive-view'
import {
  sessionState,
  type ChatSnapshot,
  type Overlay,
} from './state/chat-snapshot'
import type { ChatController } from './state/controller'
import { browserCopy, type CopyServices } from './transcript-copy'
import { systemClock, useNow, type Clock } from './ui/clock'
import { useChatController, type ChatConnection } from './useChatController'
import styles from './WorkspaceChat.module.css'

/** How the chat shows, and what it tells the app. */
export interface ChatViewProps {
  /** The phone layout takes 44 px touch targets and sheets for menus. */
  viewport: 'desktop' | 'mobile'
  /** The time source for durations and relative times. */
  clock?: Clock
  /**
   * The clipboard, the clock, and the timers of a copy of a transcript, such
   * as the services of the app. Keep it stable: it keeps the text of a copy
   * that the clipboard refused, as `copyTranscript` says. Without it, the
   * chat copies through the clipboard of the browser.
   */
  copy?: CopyServices
  /**
   * Names and draws a file or diff tab of the saved view at its place in the
   * tab row, as `RenderTab` says. Without it, the row shows only the session
   * tabs, as on a phone.
   */
  renderTab?: RenderTab
  /**
   * A page that the app shows in place of the chat of the open session, such
   * as an open file. The session tabs and the overlays stay, and no session
   * tab shows as the current one.
   */
  content?: ReactNode
  /** The workspace record, its state, and the title from its first message. */
  onWorkspaceChange?: (workspace: Workspace) => void
  /** The open tabs, as the chat saves them through the view route. */
  onViewChange?: (view: WorkspaceView) => void
  /** A file chip of a finished turn opens its diff. */
  onOpenDiff?: (path: string) => void
  /**
   * A plain click on a workspace chip in a message or an answer opens the
   * page of its link, such as through the navigation of the app. Without
   * it, a chip is a plain link that the browser opens.
   */
  onOpenPage?: (to: string) => void
  /** The notice of an agent with no login leads to its Connect form. */
  onConnectAgent?: (agent: Agent) => void
  /**
   * The files of the workspace that the composer lists after `@`, and what
   * a press on a file chip opens, as `ChatMentions` says. Without it, the
   * composer has no list, and a message shows each mention as text.
   */
  mentions?: ChatMentions
  /** The start steps and the sandbox bar that the app draws, as `ChatHost` says. */
  host?: ChatHost
  /**
   * The app shows the workspace read-only, such as while its org is
   * suspended. The chat then shows its history, changes its tabs in the
   * browser only, and sends no write. An archived workspace is read-only
   * without it.
   */
  readOnly?: boolean
  /**
   * The composer takes the focus when it shows, as after a click on the
   * workspace in the sidebar. `ComposerFocus` gives the rules.
   */
  composerFocus?: ComposerFocus | null
}

export interface WorkspaceChatProps extends ChatConnection, ChatViewProps {}

function useReport<T>(value: T | null, report?: (value: T) => void): void {
  useEffect(() => {
    if (value !== null) report?.(value)
  }, [value, report])
}

/**
 * The overlay that the chat shows. A read-only chat sends no write, so it
 * shows only the session history. An open rename or close question then
 * counts as none, also one that opened before the chat turned read-only.
 * The store keeps the edit.
 */
function permittedOverlay(overlay: Overlay, readOnly: boolean): Overlay {
  return readOnly && overlay.kind !== 'history' ? { kind: 'none' } : overlay
}

/**
 * The session tabs, the chat of the open session, and the overlays. The
 * whole column is the drop area of the message box, so a drop of files
 * anywhere on the chat attaches them, as `useChatDropArea` says.
 */
function ChatBody(
  props: ChatViewProps & { controller: ChatController; snapshot: ChatSnapshot },
) {
  const { controller, snapshot } = props
  const readOnly =
    snapshot.workspace?.state === 'archived' || (props.readOnly ?? false)
  const overlay = permittedOverlay(snapshot.overlay, readOnly)
  const mobile = props.viewport === 'mobile'
  const content = props.content ?? null
  const active = snapshot.activeSessionId
  const running = active ? sessionState(snapshot, active).transcript.turn : null
  const ticking =
    running !== null ||
    snapshot.workspace?.state === 'starting' ||
    overlay.kind === 'history'
  const now = useNow(props.clock ?? systemClock, ticking)
  const links = useChatLinksOf(controller, snapshot, props.onOpenPage)
  const copyServices = props.copy ?? browserCopy
  const copy = useTranscriptCopy(controller, copyServices)
  const copyLink = useSessionLinkCopy(
    controller.target,
    links.origin,
    copyServices,
  )
  const copyCode = useCodeCopyAction(copyServices)
  useMentionCopy()
  useReport(snapshot.workspace, props.onWorkspaceChange)
  useReport(snapshot.view, props.onViewChange)
  useFollowTabs(
    controller.places,
    snapshot.load.state === 'ready'
      ? tabSessions(snapshot).map((session) => session.id)
      : null,
  )
  const reopen = useCallback(
    (sessionId: string) => void controller.reopen(sessionId),
    [controller],
  )
  const history = historyEntries(
    historySessions(snapshot, readOnly),
    now,
    reopen,
    (item) => endedAt(snapshot, item),
  )
  const tabs = rowOf(
    snapshot.view,
    tabSessions(snapshot),
    shownTab(snapshot.view, active, content !== null),
    props.renderTab,
  )
  useTabKeys({ tabs, controller, history, copy })
  const drops = useChatDropArea()
  const body = (
    <ChatDropAreaProvider value={drops.slot}>
      <SessionTabs
        historyEntries={history}
        historyOpen={overlay.kind === 'history'}
        mobile={mobile}
        onCancelRename={controller.dismissOverlay}
        onClose={controller.requestClose}
        onCopy={copy}
        onCopyLink={copyLink}
        onMove={controller.moveTab}
        onNew={() => void controller.newSession()}
        onRename={(id, title) => void controller.rename(id, title)}
        onSelect={controller.select}
        onShowHistory={controller.showHistory}
        onStartRename={controller.startRename}
        readOnly={readOnly}
        renaming={overlay.kind === 'rename' ? overlay.sessionId : null}
        tabs={tabs}
      />
      {content ?? (
        <CodeCopyProvider value={copyCode}>
          <SessionChat
            composerFocus={props.composerFocus}
            controller={controller}
            host={props.host}
            mobile={mobile}
            now={now}
            onConnectAgent={props.onConnectAgent}
            onOpenDiff={props.onOpenDiff}
            readOnly={readOnly}
            snapshot={snapshot}
          />
        </CodeCopyProvider>
      )}
      <ChatOverlays
        history={history}
        mobile={mobile}
        onConfirmClose={controller.confirmClose}
        onDismiss={controller.dismissOverlay}
        overlay={overlay}
        sessions={snapshot.sessions}
      />
    </ChatDropAreaProvider>
  )
  const mentions = props.mentions ?? null
  if (!mobile) {
    return (
      <LinksProvider value={links}>
        <MentionsProvider value={mentions}>
          <div className={styles.column} {...drops.handlers}>
            {body}
          </div>
        </MentionsProvider>
      </LinksProvider>
    )
  }
  return (
    <LinksProvider value={links}>
      <MentionsProvider value={mentions}>
        <TouchScreen>
          <div className={styles.phone} {...drops.handlers}>
            {body}
          </div>
        </TouchScreen>
      </MentionsProvider>
    </LinksProvider>
  )
}

/**
 * The chat of one workspace: the session tabs with the session history, and
 * the chat of the open session with its composer. It loads through `client`
 * and follows the workspace through `subscribe`. Give it a stable `client`
 * and `subscribe`, as `useChatController` says.
 */
export function WorkspaceChat(props: WorkspaceChatProps) {
  const { controller, snapshot } = useChatController(
    props,
    props.readOnly ?? false,
  )
  return (
    <ChatToasts>
      <ChatBody {...props} controller={controller} snapshot={snapshot} />
    </ChatToasts>
  )
}

/**
 * The chat of a controller that the app keeps, such as across the pages of
 * a tab. The app shows and hides the controller itself, as
 * `ChatController.show` says. This view only draws it.
 */
export function WorkspaceChatView(
  props: ChatViewProps & { controller: ChatController },
) {
  const { controller } = props
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  return (
    <ChatToasts>
      <ChatBody {...props} snapshot={snapshot} />
    </ChatToasts>
  )
}
