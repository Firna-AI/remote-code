import type { TranscriptDetail } from '../../src/shared/generated/TranscriptDetail'
import type { SessionTranscriptResponse } from '../../src/shared/sessions'
import { SessionMarkdown } from '../../src/shared/transcript/session-markdown'
import { configuredModels } from '../app-api/models'
import { workspaceLink } from '../data/workspace-link'
import { readDeviceCommands } from '../devices/record-read'
import type { AppEnv } from '../env'
import { orgMembers } from '../members/member-data'
import type { BrowserAccess } from './browser-authorization'
import { invalidInput } from './inputs'
import { transcriptWorkspaceName } from './queries'
import { sessionFor } from './session-record'
import type { ChatStore } from './store'
import type { ChatStorage } from './types'

export async function sessionTranscript(
  request: Request,
  access: BrowserAccess,
  store: ChatStore,
  storage: ChatStorage,
  env: AppEnv,
): Promise<Response | null> {
  const match = access.suffix.match(/^\/sessions\/([^/]+)\/transcript$/)
  if (!match || request.method !== 'GET') return null
  let sessionId: string
  try {
    sessionId = decodeURIComponent(match[1])
  } catch {
    return invalidInput()
  }
  const detail = new URL(request.url).searchParams.get('detail')
  if (detail !== 'concise' && detail !== 'full') return invalidInput()
  return Response.json(
    await buildSessionTranscript(
      sessionId,
      detail,
      {
        workspaceId: access.workspace.id,
        orgId: access.workspace.orgId,
        number: access.presentation.number,
        origin: access.presentation.origin,
      },
      store,
      storage,
      env,
    ),
  )
}

export interface TranscriptAccess {
  workspaceId: string
  orgId: string
  number: number
  origin: string
}

export async function buildSessionTranscript(
  sessionId: string,
  detail: TranscriptDetail,
  access: TranscriptAccess,
  store: ChatStore,
  storage: ChatStorage,
  env: AppEnv,
): Promise<SessionTranscriptResponse> {
  const workspaceId = access.workspaceId
  const document = await store.run(() =>
    store.read(workspaceId, async (view) => {
      const session = await sessionFor(view, sessionId)
      const [name, members, commands, source] = await Promise.all([
        transcriptWorkspaceName(env.DB, workspaceId),
        orgMembers(env.DB, access.orgId),
        readDeviceCommands(storage),
        session.sourceSessionId
          ? view.session(session.sourceSessionId)
          : undefined,
      ])
      return {
        linkContext: { origin: access.origin, orgId: access.orgId },
        session,
        eventNumber: view.eventNumber,
        copiedAt: view.now,
        workspace: {
          number: access.number,
          name: name?.name ?? null,
          link: workspaceLink(access.origin, access.orgId, workspaceId),
        },
        models: configuredModels(env),
        members: members.map((member) => member.user),
        commands: commands.filter(
          (command) =>
            command.workspaceId === workspaceId &&
            command.sessionId === sessionId,
        ),
        ...(source ? { sourceTitle: source.title } : {}),
      }
    }),
  )
  const builder = new SessionMarkdown(document)
  let after = 0
  for (;;) {
    const page = await store.run(() =>
      store.read(workspaceId, (view) =>
        view.history(after, document.eventNumber, { sessionId }),
      ),
    )
    builder.merge(page.events)
    if (!page.hasMore) break
    after = page.nextAfterEventNumber
  }
  return { markdown: builder.render(detail) }
}
