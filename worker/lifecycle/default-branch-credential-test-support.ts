import { MACHINE_PATHS, TOOL_TURN_HEADER } from '../../src/shared/agent-tools'

import { saveGitHubTokens } from '../security/github-tokens'
import { TEST_TIME } from '../test-support/harness'
import type { backendFixture } from './backend-test-support'
import { FIRST_MESSAGE } from './durable-test-support'
import { handleGitCredential } from './machine'
import { readWorkspaceToken } from './tokens'
import { createWorkspace } from './workspaces'
import { seedBackendLogin } from './backend-seed.test-support'

export const SENDER_GITHUB_TOKEN = 'bootstrap-sender-github-token'

/** Keep the HTTP credential helper boundary local, but use the real route. */
export async function defaultBranchCredential(
  fixture: Awaited<ReturnType<typeof backendFixture>>,
) {
  const { runtime, org, user } = fixture
  const sender = {
    ...user,
    id: 'bootstrap-sender',
    githubId: 18,
    githubLogin: 'teammate',
    displayName: 'Trusted Sender',
  }
  await runtime.env.DB.batch([
    runtime.env.DB.prepare(
      'INSERT INTO users (id, github_id, github_login, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(
      sender.id,
      sender.githubId,
      sender.githubLogin,
      TEST_TIME,
      TEST_TIME,
    ),
    runtime.env.DB.prepare(
      "INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
    ).bind(org.id, sender.id, TEST_TIME),
  ])
  await saveGitHubTokens(
    runtime.env,
    sender.id,
    {
      accessToken: SENDER_GITHUB_TOKEN,
      expiresAt: null,
      refreshToken: null,
      refreshExpiresAt: null,
    },
    TEST_TIME,
  )
  await seedBackendLogin(fixture.harness, sender.id)
  const created = await fixture.run(() =>
    createWorkspace(
      runtime,
      org.id,
      user,
      { repositoryId: fixture.repositoryId, firstMessage: FIRST_MESSAGE },
      sender,
    ),
  )
  const start = fixture.starts.get(created.workspace.id)
  if (!start) throw new Error('The create job is missing.')
  while ((await start.job())?.phase !== 'fetch') await start.advance()
  const token = await readWorkspaceToken(runtime.env, created.workspace.id)
  const turns: string[] = []
  return {
    sender,
    workspaceId: created.workspace.id,
    turnId: created.first.turnId,
    turns,
    issue: (turnId: string) => {
      turns.push(turnId)
      return handleGitCredential(
        new Request(
          `${runtime.env.MACHINE_ORIGIN}${MACHINE_PATHS.gitCredential}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              [TOOL_TURN_HEADER]: turnId,
            },
          },
        ),
        runtime,
      )
    },
  }
}
