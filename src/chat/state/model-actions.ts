import type { AgentChoice } from '../../shared/generated/AgentChoice'
import { readyIds } from '../../app/draft-files'
import { markedFiles } from '../../app/draft-file-state'
import type {
  ChangeModelRequest,
  ChangeModelResponse,
} from '../../shared/sessions'
import { hasMessages, sessionState } from './chat-snapshot'
import { isRefusal, showNotice, type ChatContext } from './context'
import { changeDraft, keepFiles } from './drafts'
import { hydrate } from './history'
import { waitingMove, type PendingMove } from './model-moves'
import { beginEdit, confirmRecord } from './session-records'

/**
 * A model of the same agent stays in the session. A model of the other
 * agent opens a new session, and the draft moves there (decision 51). A
 * session with no message yet keeps a model of the other agent too, because
 * no agent conversation exists yet. The server decides which case applies,
 * because a tab can lack messages that the server has.
 *
 * The client chooses the ID of the new session, so the draft moves in the
 * snapshot that first shows the session, whether the ordered stream or the
 * reply shows it first, as `model-moves.ts` says. A tab that the user types
 * in before the reply then keeps its text. The reply then only removes the
 * sent files that the backend did not keep, from the draft that moved,
 * wherever it is now.
 *
 * A change that opens a session waits until its record shows or the server
 * refuses it. A failure with no answer, such as a lost connection, is no
 * refusal: the server can still have opened the session, so its record
 * still moves the draft once, as it is then. A new pick of the same model
 * sends the same request again, with its session ID and its draft, so the
 * server takes it as the same change and opens no second session.
 *
 * Two orders apply. A change that the tab expects to stay in the session
 * shows at once as a pending edit over the newest record, as
 * `session-records.ts` says. A change of the other agent also waits as a
 * move, in case the server opens a session after all. Then the edit fails. Confirmation
 * retires older edits of the same field. The draft move and the focus follow
 * the newest pick: a session that an older pick created shows as a tab, but
 * it takes neither the draft nor the focus.
 */
export async function chooseModel(
  context: ChatContext,
  sessionId: string,
  choice: AgentChoice,
): Promise<void> {
  const snapshot = context.store.get()
  const session = snapshot.sessions.find((item) => item.id === sessionId)
  if (!session) return
  const pick = (context.picks.get(sessionId) ?? 0) + 1
  context.picks.set(sessionId, pick)
  const latest = () => context.live() && context.picks.get(sessionId) === pick
  const state = sessionState(snapshot, sessionId)
  const { draft } = state
  const sameAgent = choice.agent === session.choice.agent
  const stays = sameAgent || !hasMessages(state)
  const waiting = sameAgent ? null : waitingMove(context, sessionId, choice)
  const request: ChangeModelRequest = waiting?.request ?? {
    choice,
    draft: {
      text: draft.text,
      attachmentIds: readyIds(markedFiles(draft.text, draft.files)),
    },
    newSessionId: context.newId(),
  }
  const { newSessionId } = request
  const move: PendingMove = waiting ?? {
    from: sessionId,
    request,
    pick,
    moved: null,
  }
  move.pick = pick
  if (!sameAgent) context.moves.set(newSessionId, move)
  const edit = stays ? beginEdit(context, sessionId, { choice }) : null
  let response: ChangeModelResponse
  try {
    response = await context.api.changeModel(sessionId, request)
  } catch (error) {
    edit?.fail()
    if (!sameAgent && isRefusal(error)) context.moves.delete(newSessionId)
    if (latest())
      showNotice(context, sessionId, "The model didn't change", error)
    return
  }
  if (!context.live()) return
  if (!response.created) {
    context.moves.delete(newSessionId)
    if (edit) edit.confirm(response.session, response.eventNumber)
    else confirmRecord(context, response.session, response.eventNumber)
    return
  }
  edit?.fail()
  confirmRecord(context, response.session, response.eventNumber)
  context.moves.delete(newSessionId)
  const moved = move.moved
  if (moved !== null) {
    changeDraft(context, moved, (current) =>
      keepFiles(current, request.draft, response.draft),
    )
  }
  if (context.store.get().activeSessionId === response.session.id) {
    await hydrate(context, response.session.id)
  }
}
