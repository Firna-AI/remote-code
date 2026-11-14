import type { AgentReadSessionRequest } from '../../src/shared/generated/AgentReadSessionRequest'
import type { AgentListSessionsRequest } from '../../src/shared/generated/AgentListSessionsRequest'
import { AGENT_TRANSCRIPT_MAX_BYTES } from '../../src/shared/agent-sessions'
import { sessionLink } from '../../src/shared/session-link'
import { jsonBytes } from '../../src/shared/event-limits'
import { AttachmentWorkspace } from '../chat/attachment-workspace'
import { buildSessionTranscript } from '../chat/session-transcript'
import { transcriptWindow } from '../chat/transcript-window'
import { sessionFor } from '../chat/session-record'
import { featureResult } from '../features/result'
import { HttpError } from '../http'
import { toolSessionWorkspace } from './session-access'
import { toolSessionSummary } from './session-summary'

export class AgentSessionReadWorkspace extends AttachmentWorkspace {
  listAgentSessions(
    orgId: string,
    workspaceId: string,
    origin: string,
    input: AgentListSessionsRequest = {},
  ) {
    return featureResult(() =>
      this.chat.readWorkspace(workspaceId, async (view) => {
        const workspace = await toolSessionWorkspace(
          this.env.DB,
          orgId,
          workspaceId,
          origin,
        )
        const sessions = await view.sessions()
        sessions.sort(
          (a, b) =>
            a.createdAt - b.createdAt ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        )
        const offset = input.offset ?? 0
        const selected = sessions.slice(
          offset,
          input.limit === undefined ? undefined : offset + input.limit,
        )
        return {
          workspace,
          sessions: await Promise.all(
            selected.map((session) =>
              toolSessionSummary(view, session, orgId, origin),
            ),
          ),
          ...(input.limit !== undefined && {
            hasMore: sessions.length > offset + input.limit,
          }),
        }
      }),
    )
  }

  getAgentSession(
    orgId: string,
    workspaceId: string,
    sessionId: string,
    origin: string,
  ) {
    return featureResult(() =>
      this.chat.readWorkspace(workspaceId, async (view) => ({
        workspace: await toolSessionWorkspace(
          this.env.DB,
          orgId,
          workspaceId,
          origin,
        ),
        session: await toolSessionSummary(
          view,
          await sessionFor(view, sessionId),
          orgId,
          origin,
        ),
      })),
    )
  }

  getAgentMessage(
    orgId: string,
    workspaceId: string,
    sessionId: string,
    messageId: string,
    origin: string,
  ) {
    return featureResult(() =>
      this.chat.readWorkspace(workspaceId, async (view) => {
        const workspace = await toolSessionWorkspace(
          this.env.DB,
          orgId,
          workspaceId,
          origin,
        )
        await sessionFor(view, sessionId)
        const stored = await view.message(messageId)
        if (!stored || stored.sessionId !== sessionId)
          throw new HttpError(
            404,
            'message_not_found',
            'The message is not available.',
          )
        const { id, sender, text, state, createdAt } = stored
        return {
          workspace,
          session: {
            id: sessionId,
            link: sessionLink(origin, orgId, workspaceId, sessionId),
          },
          message: { id, sessionId, sender, text, state, createdAt },
          turnId: (await view.messageTurn(id)) ?? null,
        }
      }),
    )
  }

  readAgentSession(
    orgId: string,
    workspaceId: string,
    sessionId: string,
    input: AgentReadSessionRequest,
    origin: string,
  ) {
    return featureResult(async () => {
      const workspace = await this.chat.readWorkspace(workspaceId, () =>
        toolSessionWorkspace(this.env.DB, orgId, workspaceId, origin),
      )
      const detail = input.detail ?? 'concise'
      const { markdown } = await buildSessionTranscript(
        sessionId,
        detail,
        {
          workspaceId,
          orgId,
          number: workspace.number,
          origin,
        },
        this.chat.store,
        this.integration.storage,
        this.env,
      )
      const metadata = {
        workspace,
        session: {
          id: sessionId,
          link: sessionLink(origin, orgId, workspaceId, sessionId),
        },
        detail,
      }
      // The position fields need at most seven numbers with this many digits.
      const positionBytes = 256 + 7 * String(markdown.length + 1).length
      const budget =
        AGENT_TRANSCRIPT_MAX_BYTES - jsonBytes(metadata) - positionBytes
      return { ...metadata, ...transcriptWindow(markdown, input, budget) }
    })
  }
}
