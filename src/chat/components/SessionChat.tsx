import type { WorkspaceState } from '../../shared/generated/WorkspaceState'
import { useMemo, type ReactNode } from 'react'
import type { Agent } from '../../shared/generated/Agent'
import { modelLabel } from '../../shared/agents'

import { PendingCommands } from '../device/PendingCommands'
import { DeviceLoadNotice, sessionCommands } from '../device/session-commands'
import { tabSessions } from '../state/archive-view'
import { sendBlock } from '../state/blockers'
import {
  hasMessages,
  sessionState,
  type ChatSnapshot,
} from '../state/chat-snapshot'
import type { ChatController } from '../state/controller'
import { failedFirstStart } from '../../app/first-start'
import {
  composerModels,
  loginLabelOf,
  sessionLoginOf,
} from '../state/session-login'
import { ChatPane } from './ChatPane'
import { placeMemory } from './chat-place'
import { ActionNotice, BlockNotice, LinkedSessionNotice } from './ChatNotices'
import { Composer, type ComposerFocus } from './Composer'
import { SandboxBar, StartingCard, type SandboxProblem } from './SandboxState'
import {
  EarlierLoading,
  emptyView,
  historyStatus,
  HistoryFailure,
  showsContent,
} from './SessionStatus'
import { sourceInsert } from './SourceLine'
import { TranscriptView } from './TranscriptView'

function problemOf(state: WorkspaceState | undefined): SandboxProblem | null {
  return state === 'stopped' || state === 'error' || state === 'archived'
    ? state
    : null
}

/**
 * The parts of the chat that the app draws from its own record of the
 * workspace: the start steps at the end of the history while the sandbox
 * starts, and the bar under the chat while the sandbox is down. Null leaves
 * the place empty. Without a host, the chat draws both from its own record.
 */
export interface ChatHost {
  starting: ReactNode | null
  sandboxBar: ReactNode | null
  /**
   * The composer stays under the bar, as after a failed first start, so that
   * members can still queue messages. Otherwise the bar takes its place.
   */
  keepsComposer: boolean
}

export interface SessionChatProps {
  snapshot: ChatSnapshot
  controller: ChatController
  mobile: boolean
  now: number
  onOpenDiff?: (path: string) => void
  onConnectAgent?: (agent: Agent) => void
  host?: ChatHost
  /**
   * The host shows the workspace read-only, such as while its org is
   * suspended. The chat then shows its history and no control that writes.
   */
  readOnly?: boolean
  /** The composer takes the focus when it shows, as `ComposerFocus` says. */
  composerFocus?: ComposerFocus | null
}

/**
 * The start steps and the sandbox bar: the host's, or the chat's own. A
 * read-only chat without a host shows only the bar of an archived
 * workspace, because it offers no Resume. The chat's own bar shows the
 * message that the workspace saved for a failed start, and after a failed
 * first start the composer stays under it.
 */
function sandboxParts(props: SessionChatProps): ChatHost {
  if (props.host) return props.host
  const { snapshot, controller, now } = props
  const { workspace } = snapshot
  const problem = problemOf(workspace?.state)
  const readOnly = props.readOnly ?? false
  const firstStart = failedFirstStart(workspace, snapshot.start)
  return {
    starting:
      workspace?.state === 'starting' && !readOnly ? (
        <StartingCard now={now} start={snapshot.start} />
      ) : null,
    sandboxBar:
      problem && workspace && (problem === 'archived' || !readOnly) ? (
        <SandboxBar
          archivedAt={workspace.archivedAt}
          busy={snapshot.resuming}
          firstStart={firstStart}
          message={snapshot.savedError}
          onResume={() => void controller.resume()}
          problem={problem}
        />
      ) : null,
    keepsComposer: firstStart && !readOnly,
  }
}

/**
 * The attached files of a draft, which the chips of its field show: one
 * source for each identity of the draft. A draft that moves to another
 * session keeps its identity, so its field keeps the source, and the source
 * finds the files of the draft also during the move.
 */
function useDraftFiles(controller: ChatController, draftId: string) {
  return useMemo(() => controller.draftFiles(draftId), [controller, draftId])
}

/**
 * The chat of the open session: its history, with the start steps while the
 * sandbox starts, and under it the notices and the composer, or the bar that
 * takes the composer's place while the sandbox does not run. After a failed
 * first start, the bar sits above the composer, which stays. The status of
 * the stored history comes from its load alone, so content never hides a
 * failed load. The composer names the login of another member that a
 * message spends. A linked session starts with a link to the session that
 * it started from. The shown record comes from the tabs, so a closed
 * session that an archived workspace shows keeps its link too. A read-only
 * workspace, archived or of a suspended org, shows no composer and no
 * control that writes.
 */
export function SessionChat(props: SessionChatProps) {
  const { snapshot, controller, now } = props
  const { workspace } = snapshot
  const id = snapshot.activeSessionId
  const session = tabSessions(snapshot).find((item) => item.id === id) ?? null
  const state = sessionState(snapshot, id ?? '')
  const files = useDraftFiles(controller, state.draft.id)
  const { starting, sandboxBar, keepsComposer } = sandboxParts(props)
  const readOnly = (props.readOnly ?? false) || workspace?.state === 'archived'
  // A bar or a read-only workspace takes the place of the composer. The bar
  // of a failed first start keeps the composer under it.
  const down = (sandboxBar !== null && !keepsComposer) || readOnly
  const block = sendBlock(snapshot, id)
  const { notice } = snapshot
  const shownNotice =
    notice && (notice.sessionId === null || notice.sessionId === id)
      ? notice
      : null
  // Only this chat's own sends wait as pending messages, so each new one
  // shows the bottom of the chat.
  const sent = useMemo(
    () => state.pending.map((message) => message.id),
    [state.pending],
  )
  const place = useMemo(
    () => (id ? placeMemory(controller.places, id) : null),
    [controller, id],
  )
  const status = historyStatus(state)
  const content = showsContent(state, starting !== null)
  const viewerId = snapshot.account?.user.id ?? null
  const commands = sessionCommands(snapshot, id, state)
  const login = session ? sessionLoginOf(session, viewerId) : null
  const openSession = (sessionId: string) => {
    const open = snapshot.sessions.some((item) => item.id === sessionId)
    void (open ? controller.select(sessionId) : controller.reopen(sessionId))
  }
  const source = sourceInsert(snapshot, session, openSession)
  const footer = (
    <>
      {id && content && status === 'failed' ? (
        <HistoryFailure
          besideContent
          onRetry={() => void controller.loadHistory(id)}
        />
      ) : null}
      {shownNotice ? (
        <ActionNotice
          notice={shownNotice}
          onDismiss={controller.dismissNotice}
        />
      ) : null}
      {!down && session && block ? (
        <BlockNotice
          block={block}
          model={modelLabel(snapshot.models, session.choice)}
          onConnectAgent={props.onConnectAgent}
        />
      ) : null}
      {!down && session && !block && login?.kind === 'linked' ? (
        <LinkedSessionNotice
          agent={session.choice.agent}
          reason={login.reason}
          starter={login.starter}
        />
      ) : null}
      {snapshot.devices.load === 'failed' ? (
        <DeviceLoadNotice onRetry={() => void controller.loadDevices()} />
      ) : null}
      <PendingCommands
        devices={snapshot.devices}
        onAnswer={(requestId, action) =>
          void controller.answerCommand(requestId, action)
        }
        readOnly={readOnly}
        readers={{ viewerId, orgName: snapshot.org?.name ?? null }}
        requests={commands.waiting}
      />
      {sandboxBar}
      {!down && session && snapshot.load.state === 'ready' ? (
        <Composer
          blocked={block !== null}
          choice={session.choice}
          draft={state.draft}
          files={files}
          focus={props.composerFocus}
          login={loginLabelOf(login)}
          models={composerModels(
            login,
            snapshot.models,
            snapshot.account?.agentLogins ?? [],
            session.choice,
          )}
          onAttach={(picked, refusals) =>
            controller.attachFiles(session.id, picked, refusals)
          }
          onChangeText={(text) => controller.setDraft(session.id, text)}
          onChooseModel={(choice) =>
            void controller.chooseModel(session.id, choice)
          }
          onSend={() => void controller.send(session.id)}
          onStop={() => void controller.interrupt(session.id)}
          running={state.transcript.turn !== null}
          sending={state.draft.sending}
          sessionAgent={hasMessages(state) ? session.choice.agent : undefined}
          startsSession={login?.kind === 'linked'}
          stopping={state.stopping}
        />
      ) : null}
    </>
  )
  return (
    <ChatPane
      empty={emptyView({
        snapshot,
        controller,
        starting: starting !== null,
        readOnly,
      })}
      footer={footer}
      mobile={props.mobile}
      place={place}
      sent={sent}
    >
      {content && status === 'loading' ? <EarlierLoading /> : null}
      <TranscriptView
        inserts={source ? [source, ...commands.inserts] : commands.inserts}
        now={now}
        onOpenDiff={props.onOpenDiff}
        onRetry={(messageId) => id && void controller.retry(id, messageId)}
        pending={state.pending}
        readers={{ viewerId, members: snapshot.members }}
        readOnly={readOnly}
        retrying={state.retrying}
        transcript={state.transcript}
      >
        {starting}
      </TranscriptView>
    </ChatPane>
  )
}
