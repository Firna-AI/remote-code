import { useCallback, useMemo, type ReactNode } from 'react'
import type { WorkspaceStart } from '../../shared/generated/WorkspaceStart'
import {
  replacesComposer,
  type SandboxNoticeState,
} from '../../../docs/mockups/src/components/workspace/sandboxNoticeState'
import { routes } from '../../app/router'
import { useServices } from '../../app/services'
import { useStore } from '../../app/store'
import type { ComposerFocus } from '../../chat/components/Composer'
import type { ChatHost } from '../../chat/components/SessionChat'
import type { ChatController } from '../../chat/state/controller'
import { WorkspaceChatView } from '../../chat/WorkspaceChat'
import { useApp } from '../context'
import { useGo } from '../ui/AppLink'
import type { Action } from '../ui/useAction'
import { useFeatures, type WorkspaceContext } from './features'
import { useChatFiles } from './files/chat-files'
import { filesCenter } from './files/files-features'
import { SandboxBar } from './SandboxNotice'
import { StartingCard } from './StartingCard'
import { ChatColumn } from './WorkspaceColumns'

/**
 * The focus request of the app for the composer of `workspaceId`, until the
 * composer takes it. A phone opens no keyboard on its own.
 */
function useComposerFocus(
  workspaceId: string,
  phone: boolean,
): ComposerFocus | null {
  const store = useApp().composerFocus
  const request = useStore(store)
  const done = useCallback(
    () => store.change((current) => (current === request ? null : current)),
    [store, request],
  )
  return useMemo(
    () =>
      request && request.workspaceId === workspaceId && !phone
        ? { request, done }
        : null,
    [request, done, workspaceId, phone],
  )
}

/**
 * The kept chat of the workspace, with the parts that the shell draws, and
 * the open files: their tabs at their places in the tab row, and `content`,
 * a file or diff tab in place of the chat of the session.
 */
function KeptChat(props: {
  context: WorkspaceContext
  chat: ChatController
  host: ChatHost
  content: ReactNode
}) {
  const { context } = props
  const services = useServices()
  const go = useGo()
  const clock = useMemo(() => ({ now: services.now }), [services])
  const files = useChatFiles(context, props.content)
  const phone = context.viewport === 'phone'
  const focus = useComposerFocus(context.workspace.id, phone)
  return (
    <WorkspaceChatView
      clock={clock}
      composerFocus={focus}
      content={props.content}
      controller={props.chat}
      copy={services}
      host={props.host}
      mentions={files.mentions}
      onConnectAgent={(agent) => go(routes.account(agent))}
      onOpenDiff={files.onOpenDiff}
      onOpenPage={go}
      readOnly={context.readOnly}
      renderTab={files.renderTab}
      viewport={phone ? 'mobile' : 'desktop'}
    />
  )
}

/**
 * The chat area of the open workspace: the session tabs, the chat, and its
 * composer. The shell draws the start steps at the end of the chat and the
 * bar of a sandbox that is down, from its own record of the workspace, and
 * the chat places them. `notice` is that bar's state: a start that the app
 * refused, with its reason, such as in a suspended org, or a start that
 * failed, with the message that the workspace saved for it. The bar takes
 * the place of the composer, except after a failed first start, whose
 * composer stays under it. `orgNotice` is
 * the notice of a suspended org above the bar of an archived workspace. A
 * read-only workspace shows its chat read-only. The chat shows the open
 * file tabs, and on desktop the file or diff tab of the address in place of
 * the chat of its session. A host that gives the `tabs`, `transcript`, or
 * `composer` slot gets the shell's own column with those slots instead. A
 * `center` part of the host takes the place of the chat.
 */
export function ChatArea(props: {
  context: WorkspaceContext
  chat: ChatController
  start: WorkspaceStart | null
  notice: SandboxNoticeState | null
  orgNotice: ReactNode | null
  resume: Action<[]>
}) {
  const features = useFeatures()
  const { context, notice } = props
  const { sandbox, workspace } = context
  const phone = context.viewport === 'phone'
  const starting =
    sandbox === 'starting' && props.start ? (
      <StartingCard start={props.start} />
    ) : null
  const sandboxBar = notice ? (
    <>
      {props.orgNotice}
      <SandboxBar
        notice={notice}
        restore={
          context.restore
            ? { run: context.restore, pending: context.running === 'restore' }
            : null
        }
        resume={props.resume}
        workspace={workspace}
      />
    </>
  ) : null
  const keepsComposer = notice !== null && !replacesComposer(notice)
  const center = features.center?.(context) ?? null
  if (features.tabs || features.transcript || features.composer) {
    const composer = features.composer?.(context)
    return (
      <>
        {features.tabs?.(context)}
        {center ?? (
          <ChatColumn
            footer={
              keepsComposer ? (
                <>
                  {sandboxBar}
                  {composer}
                </>
              ) : (
                (sandboxBar ?? composer)
              )
            }
            phone={phone}
            starting={starting}
            transcript={features.transcript?.(context)}
          />
        )}
      </>
    )
  }
  return (
    center ?? (
      <KeptChat
        chat={props.chat}
        content={features.center ? null : filesCenter(context)}
        context={context}
        host={{ starting, sandboxBar, keepsComposer }}
      />
    )
  )
}
