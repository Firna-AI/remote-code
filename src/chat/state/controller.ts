import type { TranscriptDetail } from '../../shared/generated/TranscriptDetail'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import type { IntakeRefusals } from '../../app/draft-files'
import type { DeviceApprovalAction } from '../../shared/device'

import type { WorkspaceTab, WorkspaceView } from '../../shared/workspace-view'
import { createChatApi, type WorkspaceTarget } from '../api/client'
import type { SessionReads } from '../links/session-reads'
import { answerCommand, refreshDevices } from '../device/device-actions'
import { browserTimers } from '../stream/workspace-stream'
import { copyTranscript, type CopyServices } from '../transcript-copy'
import {
  ChatStore,
  initialSnapshot,
  type ChatSnapshot,
  type Overlay,
} from './chat-snapshot'
import { showAddressSession } from './address-session'
import { closeLocally, isArchived, showLocally } from './archive-view'
import { attachFiles } from './attachment-actions'
import type { ChatContext } from './context'
import {
  createChatContext,
  type ChatContextOptions,
} from './controller-context'
import { hydrate, watchShownSession } from './history'
import { followSources, withSources } from './sources'
import { loadChat } from './load'
import { endDraftFiles } from './drafts'
import {
  interruptTurn,
  resumeWorkspace,
  retryTurn,
  sendDraft,
  setDraftText,
} from './message-actions'
import { chooseModel } from './model-actions'
import { draftFileSource } from './draft-file-source'
import { sendPrompt, type PromptOutcome } from './prompt-actions'
import { moveTab } from './tab-actions'
import type { TabPlace } from './tab-order'
import { ownWorkspaceList, type WorkspaceList } from './workspace-list'
import {
  confirmClose,
  newSession,
  renameSession,
  reopenSession,
  requestClose,
  selectSession,
  updateView,
} from './session-actions'

export interface ChatControllerOptions extends ChatContextOptions {
  /**
   * Whether the host shows the workspace read-only, such as while its org
   * is suspended. The controller reads it at each action, because a
   * suspension can start during a visit.
   */
  readOnly?: () => boolean
}

/**
 * The chat of one workspace. It loads the sessions and the history of the
 * shown session, reads the workspace stream, and runs the user's actions
 * against the API. React reads it through `subscribe` and `getSnapshot`.
 * Each `start` begins a fresh run, and `stop` makes late responses of the
 * run change nothing. An app that keeps the chat while it shows another page
 * calls `hide` and `show` instead, as `show` says.
 */
export class ChatController {
  /** The org and the workspace of the chat. */
  readonly target: WorkspaceTarget
  /**
   * The workspaces whose links show as chips. The chat watches them while
   * it shows, from `start` or `show` to `hide` or `stop`.
   */
  readonly workspaceList: WorkspaceList
  private readonly options: ChatControllerOptions
  private readonly store = new ChatStore()
  /** The reader's place in each session tab, while the app keeps the chat. */
  readonly places = this.store.places
  private context: ChatContext
  private run = 0
  private started = false
  private unwatch: (() => void) | null = null
  private unfollow: (() => void) | null = null
  private unlist: (() => void) | null = null

  constructor(options: ChatControllerOptions) {
    this.options = options
    this.target = options.target
    this.context = this.createContext(this.run)
    const { sources, client, target } = options
    this.workspaceList = sources
      ? { workspaces: sources.workspaces, watch: sources.watchWorkspaces }
      : ownWorkspaceList(
          createChatApi(client, target),
          options.timers ?? browserTimers,
        )
  }

  readonly subscribe = (listener: () => void) => this.store.subscribe(listener)
  readonly getSnapshot = (): ChatSnapshot => this.store.get()

  /** The reads of the sessions of linked workspaces for this load. */
  get sessionReads(): SessionReads {
    return this.context.sessionReads
  }

  /**
   * Loads the chat, then opens its stream. From now on, each session that
   * becomes the shown session loads its history.
   */
  readonly start = (): Promise<void> => {
    this.stop()
    this.started = true
    this.context = this.createContext(this.run)
    const { sources } = this.options
    const fresh = { ...initialSnapshot, draftEpoch: this.run }
    // The values of the app replace the reset ones at once, then follow it.
    this.store.update(() => (sources ? withSources(fresh, sources) : fresh))
    this.unfollow = sources ? followSources(this.store, sources) : null
    this.unwatch = watchShownSession(this.context)
    this.unlist = this.workspaceList.watch()
    return loadChat(this.context)
  }

  readonly stop = (): void => {
    this.run += 1
    this.context.sessionReads.close()
    for (const upload of this.context.uploads.values()) upload.abort()
    this.context.uploads.clear()
    this.store.update((snapshot) => ({
      ...snapshot,
      sessionStates: Object.fromEntries(
        Object.entries(snapshot.sessionStates).map(([id, state]) => [
          id,
          { ...state, draft: endDraftFiles(state.draft) },
        ]),
      ),
    }))
    this.unwatch?.()
    this.unwatch = null
    this.unfollow?.()
    this.unfollow = null
    this.unlist?.()
    this.unlist = null
    this.context.stream.stop()
  }

  /**
   * Shows the chat. The first show loads it, as `start` does, and so does a
   * show after a failed load. A later show opens the stream again after its
   * cursor, so the chat shows at once and gets only the newer events. A load
   * that still runs keeps going, and its end opens the stream.
   */
  readonly show = (): void => {
    if (!this.started || this.store.get().load.state === 'failed') {
      void this.start()
      return
    }
    this.context.stream.release()
    this.unlist ??= this.workspaceList.watch()
  }

  /**
   * Closes the stream while the app shows another page. The chat keeps its
   * sessions, drafts, transcripts, and cursor, and the actions and loads that
   * run still finish.
   */
  readonly hide = (): void => {
    this.context.stream.hold()
    this.unlist?.()
    this.unlist = null
  }

  private createContext(run: number): ChatContext {
    const live = () => this.run === run
    return createChatContext(this.options, this.store, live, run)
  }

  private overlay(overlay: Overlay): void {
    this.store.update((snapshot) => ({ ...snapshot, overlay }))
  }

  /**
   * A read-only workspace, archived or shown read-only by the host, changes
   * its tabs in the browser only, and sends no write.
   */
  private readOnly(): boolean {
    return isArchived(this.store.get()) || (this.options.readOnly?.() ?? false)
  }

  /** Runs a write of the user, unless the workspace is read-only. */
  private write(action: () => Promise<unknown>): Promise<void> {
    return this.readOnly() ? Promise.resolve() : action().then(() => undefined)
  }

  readonly select = (sessionId: string) =>
    this.readOnly()
      ? showLocally(this.context, sessionId)
      : selectSession(this.context, sessionId)
  /**
   * Shows the open session that an app address names, as
   * `showAddressSession` says. An abort of `signal`, such as at a newer
   * address, makes the lookup show nothing.
   */
  readonly showAddress = (sessionId: string, signal: AbortSignal) =>
    showAddressSession(
      this.context,
      sessionId,
      () => !signal.aborted,
      (id) => void this.select(id),
    )
  readonly newSession = () => this.write(() => newSession(this.context))
  readonly startRename = (sessionId: string) =>
    this.overlay({ kind: 'rename', sessionId })
  readonly rename = (sessionId: string, title: string) =>
    this.write(() => renameSession(this.context, sessionId, title))
  readonly requestClose = async (sessionId: string): Promise<void> => {
    if (!this.readOnly()) return requestClose(this.context, sessionId)
    closeLocally(this.context, sessionId)
  }
  readonly confirmClose = () => this.write(() => confirmClose(this.context))
  readonly showHistory = (open: boolean) =>
    this.overlay(open ? { kind: 'history' } : { kind: 'none' })
  readonly dismissOverlay = () => this.overlay({ kind: 'none' })
  /** Reopens a closed session, or shows its history in a read-only workspace. */
  readonly reopen = (sessionId: string) =>
    this.readOnly()
      ? showLocally(this.context, sessionId)
      : reopenSession(this.context, sessionId)
  readonly loadHistory = (sessionId: string) =>
    hydrate(this.context, sessionId, true)
  readonly setDraft = (sessionId: string, text: string) =>
    setDraftText(this.context, sessionId, text)
  readonly attachFiles = (
    sessionId: string,
    files: readonly File[],
    refusals?: IntakeRefusals,
  ) =>
    this.readOnly() ? [] : attachFiles(this.context, sessionId, files, refusals)
  /** A field follows its draft identity, also during a move before React renders. */
  readonly draftFiles = (draftId: string) =>
    draftFileSource(
      () => this.context,
      draftId,
      () => this.readOnly(),
    )
  readonly send = (sessionId: string) =>
    this.write(() => sendDraft(this.context, sessionId))
  /** Sends a fixed prompt to the session of the chat, as `sendPrompt` says. */
  readonly sendPrompt = (text: string): Promise<PromptOutcome> =>
    this.readOnly()
      ? Promise.resolve('unavailable')
      : sendPrompt(this.context, text)
  readonly retry = (sessionId: string, messageId: string) =>
    this.write(() => retryTurn(this.context, sessionId, messageId))
  readonly interrupt = (sessionId: string) =>
    this.write(() => interruptTurn(this.context, sessionId))
  readonly chooseModel = (sessionId: string, choice: AgentChoice) =>
    this.write(() => chooseModel(this.context, sessionId, choice))
  readonly resume = () => this.write(() => resumeWorkspace(this.context))
  /** Sends the answer to a Mac command, from the Mac app on that Mac. */
  readonly answerCommand = (requestId: string, action: DeviceApprovalAction) =>
    this.write(() => answerCommand(this.context, requestId, action))
  /** Reads the Mac commands and the pairing again, such as after a failure. */
  readonly loadDevices = () => refreshDevices(this.context)
  /**
   * Changes the saved view with a change of the app, such as an open file
   * tab, through the one writer of the view. Until the load reads the view,
   * it changes nothing, so the saved tabs stay. A read-only workspace keeps
   * the change in the browser and sends no write.
   */
  readonly updateView = (change: (view: WorkspaceView) => WorkspaceView) =>
    updateView(this.context, change, !this.readOnly())
  readonly moveTab = (tab: WorkspaceTab, place: TabPlace): void => {
    if (!this.readOnly()) moveTab(this.context, tab, place)
  }
  /**
   * Copies the transcript of a session, as `copyTranscript` says. Call it
   * during the press, so that its clipboard write starts at once. It only
   * reads, so a read-only workspace copies too, and the shown tab, the
   * view, and the loaded history stay as they are.
   */
  readonly copyTranscript = (
    services: CopyServices,
    sessionId: string,
    detail: TranscriptDetail,
  ): Promise<void> =>
    copyTranscript({
      services,
      api: this.context.api,
      target: this.target,
      sessionId,
      detail,
    })
  readonly dismissNotice = () =>
    this.store.update((snapshot) => ({ ...snapshot, notice: null }))
}
