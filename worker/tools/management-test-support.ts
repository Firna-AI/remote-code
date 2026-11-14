import type { AgentSessionSummary } from '../../src/shared/generated/AgentSessionSummary'
import type { AgentWorkspaceSummary } from '../../src/shared/generated/AgentWorkspaceSummary'
import { sessionLink } from '../../src/shared/session-link'
import { workspaceFixtures } from '../../src/test-support/fixtures/workspaces'
import { TEST_TIME, type TestHarness } from '../test-support/harness'
import { publishToolImage } from './list-test-support'
import { toolFixture } from './test-support'

export async function toolRouteFixture(harness: TestHarness) {
  const fixture = await toolFixture(harness)
  await publishToolImage(fixture.db)
  const sample = workspaceFixtures()
  const workspace: AgentWorkspaceSummary = {
    id: 'teammate-workspace',
    number: 2,
    link: `${harness.env.APP_ORIGIN}/org-a/workspaces/teammate-workspace`,
    name: 'Paris',
    branch: 'teammate-login/paris-cd34',
    state: 'ready',
  }
  const session: AgentSessionSummary = {
    id: 'session / one',
    link: sessionLink(
      harness.env.APP_ORIGIN,
      'org-a',
      workspace.id,
      'session / one',
    ),
    title: null,
    choice: sample.sessions.sessions[0].choice,
    startedBy: null,
    state: 'idle',
    closed: false,
  }
  const base = { workspace, session }
  fixture.services.writeWorkspace.mockResolvedValue()
  fixture.services.getSession.mockResolvedValue(base)
  fixture.services.manageSession.mockImplementation(async (input) =>
    input.kind === 'stop'
      ? { ...base, turnId: null, state: 'idle' }
      : { ...base, session: { ...session, closed: input.kind === 'close' } },
  )
  fixture.services.listSessions.mockResolvedValue({
    workspace,
    sessions: [session],
    hasMore: true,
  })
  fixture.services.getMessage.mockResolvedValue({
    workspace,
    session: { id: session.id, link: session.link },
    message: {
      id: 'message / one',
      sessionId: session.id,
      sender: sample.message.sender,
      text: 'Exact message\r\n\n',
      state: 'queued',
      createdAt: TEST_TIME,
    },
    turnId: null,
  })
  fixture.services.writeSection.mockImplementation(async (input) =>
    input.kind === 'create'
      ? { section: { id: 'new-section', name: input.name, default: false } }
      : { deleted: false },
  )
  const preview = {
    id: 'preview / one',
    port: 4321,
    url: `${harness.env.APP_ORIGIN}/preview/one`,
    expiresAt: TEST_TIME,
  }
  fixture.services.previewCall.mockImplementation(async (input) =>
    input.kind === 'list'
      ? { workspace, previews: [preview] }
      : input.kind === 'open'
        ? { workspace, preview }
        : { workspace, closed: false },
  )
  return fixture
}
