import type { User } from '../../src/shared/api'
import type { ContinueWorkspaceRequest } from '../../src/shared/workspaces'
import {
  createChatFixture,
  WORKSPACE_ID,
  WORKSPACE_TOKEN,
} from '../chat/harness.test-support'
import { createGitHubStatePort } from '../github/chat-store'
import { GitHubReader } from '../github/client'
import { RepositoryGitHub } from '../github/fake-repository'
import { repositoryPull, HEAD_SHA } from '../github/fake-pull'
import { refreshWorkspace } from '../github/refresh'
import { WorkspaceGitHubState } from '../github/workspace-state'
import type { GitHubWorkspace } from '../github/contracts'
import { saveGitHubTokens } from '../security/github-tokens'
import {
  TEST_ORIGIN,
  TEST_TIME,
  type TestHarness,
} from '../test-support/harness'
import { LifecycleBoat } from './lifecycle-boat-test-support'
import { WorkspaceContinue } from './continue'
import {
  CONTINUE_JOB_KEY,
  type ContinueJob,
  type ContinueOptions,
} from './continue-types'
import { handleGitCredential } from './machine'
import { MACHINE_PATHS, TOOL_TURN_HEADER } from '../../src/shared/agent-tools'

export async function continueFixture(harness: TestHarness) {
  const chat = await createChatFixture(harness)
  const api = new RepositoryGitHub(harness.github)
  api.branches.set('refs/heads/octocat/test', HEAD_SHA)
  api.pulls[2] = repositoryPull({
    headRefName: 'octocat/test',
    state: 'MERGED',
    mergedAt: '2026-11-09T12:00:00Z',
  })
  const boat = new LifecycleBoat()
  boat.commandOutput = ''
  boat.synchronousOutput = '\0' + '0\n'
  boat.states.set('bx_continue', 'ready')
  let inspectionBranch = 'octocat/test'
  boat.beforeCommand = async (command, detached) => {
    if (!detached && command.includes('symbolic-ref --short HEAD'))
      boat.synchronousOutput = `${inspectionBranch}\n`
  }
  await chat.env.DB.batch([
    chat.env.DB.prepare(
      "INSERT INTO github_installations (id, account_login, account_type, created_at) VALUES (1, 'example', 'Organization', ?)",
    ).bind(TEST_TIME),
    chat.env.DB.prepare(
      'UPDATE repositories SET github_repository_id = ?, full_name = ?, installation_id = 1 WHERE id = ?',
    ).bind(api.repositoryId, api.fullName, 'repo'),
    chat.env.DB.prepare(
      "UPDATE workspaces SET name = 'Kept name', state = 'ready', sandbox_id = 'bx_continue' WHERE id = ?",
    ).bind(WORKSPACE_ID),
    chat.env.DB.prepare(
      `INSERT INTO workspace_runtime (workspace_id, org_id, created_by_user_id, session_id, first_turn_id, agent, model, effort, first_message_id)
      VALUES (?, ?, ?, 'first-session', 'first-turn', 'claude', 'test-claude', 'high', 'first-message')`,
    ).bind(WORKSPACE_ID, chat.org.id, chat.owner.id),
  ])
  const user = async (id: string) => {
    const value = await chat.env.DB.prepare(
      'SELECT id, github_id AS githubId, github_login AS githubLogin, display_name AS displayName, avatar_url AS avatarUrl FROM users WHERE id = ?',
    )
      .bind(id)
      .first<User>()
    if (!value) throw new Error('Missing fixture user.')
    return value
  }
  const member = await user(chat.member.id)
  const owner = await user(chat.owner.id)
  for (const [id, accessToken] of [
    [member.id, 'member-continue-token'],
    [owner.id, 'owner-continue-token'],
  ])
    await saveGitHubTokens(
      chat.env,
      id,
      {
        accessToken,
        expiresAt: null,
        refreshToken: null,
        refreshExpiresAt: null,
      },
      TEST_TIME,
    )
  let next = 0
  const scheduled: (number | null)[] = []
  const refreshed: GitHubWorkspace[] = []
  const resumed: string[] = []
  const state = new WorkspaceGitHubState(
    createGitHubStatePort(chat.chat, WORKSPACE_ID, async () => {}),
  )
  const reads = {
    now: () => TEST_TIME,
    fetch: api.fetch,
    token: async () => 'server-read-token',
  }
  const options: ContinueOptions = {
    env: chat.env,
    chat: chat.chat,
    storage: chat.storage,
    dependencies: {
      now: () => TEST_TIME,
      randomToken: () => `continue-${++next}`,
      fetch: (request) =>
        new URL(request.url).hostname === 'api.github.com'
          ? api.fetch(request)
          : boat.fetch(request),
    },
    run: async (work) => {
      const result = await chat.chat.runLifecycle(async () => {
        const result = await work()
        await chat.chat.flushRunner()
        return result
      })
      await chat.drain()
      return result
    },
    schedule: async (at) => {
      scheduled.push(at)
    },
    refresh: (binding, signal) =>
      refreshWorkspace(chat.env.DB, binding, signal, state, reads),
    defaultBranch: (binding) =>
      new GitHubReader(reads, binding, 'server-read-token').defaultBranch(),
    scheduleRefresh: async (binding) => {
      refreshed.push(binding)
    },
    resume: async (_org, id) => {
      resumed.push(id)
      await chat.env.DB.prepare(
        "UPDATE workspaces SET state = 'ready' WHERE id = ?",
      )
        .bind(id)
        .run()
    },
    matches: (id) => id === WORKSPACE_ID,
    assertActive: async () => {},
    activity: async () => {},
  }
  let coordinator = new WorkspaceContinue(options)
  const start = (
    request: Partial<ContinueWorkspaceRequest> = {},
    sender = member,
  ) =>
    coordinator.start(
      chat.org.id,
      WORKSPACE_ID,
      sender,
      { expectedBranch: 'octocat/test', ...request },
      TEST_ORIGIN,
    )
  const active = () => chat.storage.get<ContinueJob | null>(CONTINUE_JOB_KEY)
  const advanceTo = async (phase: ContinueJob['phase']) => {
    for (let step = 0; step < 20; step++) {
      const current = await active()
      if (current?.phase === phase) return current
      if (!current) throw new Error(`Continue ended before ${phase}.`)
      await coordinator.advance()
    }
    throw new Error(`Continue did not reach ${phase}.`)
  }
  const finish = async () => {
    for (let step = 0; step < 20 && (await active()); step++)
      await coordinator.advance()
    if (await active()) throw new Error('Continue did not end.')
  }
  const credential = (id: string) =>
    handleGitCredential(
      new Request(`${chat.env.MACHINE_ORIGIN}${MACHINE_PATHS.gitCredential}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${WORKSPACE_TOKEN}`,
          [TOOL_TURN_HEADER]: id,
        },
      }),
      {
        env: chat.env,
        dependencies: options.dependencies,
        workspace: () => ({
          credentialSender: async (id) =>
            (await coordinator.credentialSender(id)) ?? null,
        }),
      },
    )
  return {
    ...chat,
    ownerUser: owner,
    memberUser: member,
    api,
    boat,
    options,
    state,
    scheduled,
    refreshed,
    resumed,
    start,
    active,
    advanceTo,
    finish,
    credential,
    get coordinator() {
      return coordinator
    },
    reconstruct: () => {
      coordinator = new WorkspaceContinue(options)
    },
    resetContinue: async () => {
      await chat.actor.api.controls.reset()
      await chat.restart()
      await chat.env.DB.prepare(
        "UPDATE workspaces SET branch = 'octocat/test', state = 'ready' WHERE id = ?",
      )
        .bind(WORKSPACE_ID)
        .run()
      coordinator = new WorkspaceContinue(options)
      inspectionBranch = 'octocat/test'
    },
    inspectBranch: (branch: string) => {
      inspectionBranch = branch
    },
    result: (id: string, sender = member) =>
      coordinator.result(chat.org.id, WORKSPACE_ID, sender.id, id, TEST_ORIGIN),
  }
}
