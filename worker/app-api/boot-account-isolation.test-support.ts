import { expect } from 'vitest'
import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import { ACCOUNT_PATHS, agentLoginPath } from '../../src/shared/account'
import { GET_STARTED_PATH } from '../../src/shared/onboarding'
import { readShortcutKeyText } from '../../src/shared/shortcut-key'
import type { TestHarness } from '../test-support/harness'
import { connectCodexDevice } from './codex-device.test-support'
import {
  expectAccountState,
  isolationAccountStates,
  putAccountValue,
  seedBootIdentity,
  type AccountState,
} from './boot-account.test-support'

export async function expectAccountIsolation(
  harness: TestHarness,
  choice: AgentChoice,
  otherChoice: AgentChoice,
): Promise<void> {
  const first = await seedBootIdentity(harness)
  const org = await harness.createOrg(first)
  await harness.env.DB.prepare(
    `INSERT INTO github_installations (id, account_login, account_type, created_at)
    VALUES (91, 'octocat', 'User', 1)`,
  ).run()
  await harness.env.DB.prepare(
    `INSERT INTO repositories
    (id, org_id, github_repository_id, full_name, default_branch, installation_id)
    VALUES ('repository', ?, 101, 'octocat/repository', 'main', 91)`,
  )
    .bind(org.id)
    .run()
  expect(
    await (await harness.request(GET_STARTED_PATH, first)).json(),
  ).toMatchObject({
    steps: [
      { step: 'github-app', complete: true },
      { step: 'org', complete: true },
      { step: 'agent-login', complete: false },
    ],
  })
  const other = await seedBootIdentity(harness, {
    githubId: 8,
    githubLogin: 'other',
    displayName: 'Other',
    avatarUrl: null,
    primaryVerifiedEmail: null,
    githubCreatedAt: null,
  })
  expect(await (await harness.request(GET_STARTED_PATH, other)).json()).toEqual(
    {
      orgId: null,
      steps: [
        { step: 'github-app', complete: false },
        { step: 'org', complete: false },
        { step: 'agent-login', complete: false },
      ],
    },
  )
  const expectBoth = async (
    firstState: AccountState,
    otherState: AccountState,
  ) => {
    await expectAccountState(harness, first, firstState, {
      githubLogin: 'octocat',
      orgId: org.id,
      githubComplete: true,
    })
    await expectAccountState(harness, other, otherState, {
      githubLogin: 'other',
      orgId: null,
      githubComplete: false,
    })
  }
  const { empty, firstConnected, firstSaved, otherConnected, otherSaved } =
    isolationAccountStates(choice, otherChoice)
  await expectBoth(empty, empty)
  await putAccountValue(harness, first, agentLoginPath('claude'), {
    agent: 'claude',
    kind: 'token',
    secret: 'first-claude-token',
  })
  await expectBoth(firstConnected, empty)
  await putAccountValue(harness, first, ACCOUNT_PATHS.defaultModel, {
    choice: otherChoice,
  })
  await expectBoth(firstSaved, empty)
  await putAccountValue(harness, other, agentLoginPath('claude'), {
    agent: 'claude',
    kind: 'api-key',
    secret: 'other-claude-key',
  })
  await expectBoth(firstSaved, otherConnected)
  const codexConnected = await connectCodexDevice(harness, other)
  expect(codexConnected.status).toBe(200)
  await expectBoth(firstSaved, otherSaved)
  await putAccountValue(harness, other, ACCOUNT_PATHS.defaultModel, { choice })
  await expectBoth(firstSaved, otherSaved)
  await putAccountValue(harness, first, ACCOUNT_PATHS.newWorkspaceView, {
    view: 'page',
  })
  const firstPage: AccountState = {
    ...firstSaved,
    newWorkspaceView: 'page',
  }
  await expectBoth(firstPage, otherSaved)
  await putAccountValue(harness, other, ACCOUNT_PATHS.newWorkspaceView, {
    view: 'dialog',
  })
  await expectBoth(firstPage, otherSaved)
  const removed = await harness.request(agentLoginPath('claude'), first, {
    method: 'DELETE',
    body: '{}',
  })
  expect(removed.status).toBe(204)
  await expectBoth(
    { ...empty, defaultChoice: otherChoice, newWorkspaceView: 'page' },
    otherSaved,
  )
  const firstShortcuts: AccountState = {
    ...empty,
    defaultChoice: otherChoice,
    newWorkspaceView: 'page',
    shortcuts: {
      mac: [
        { command: 'command-palette', keys: [readShortcutKeyText('Meta+P')] },
      ],
      other: [],
    },
  }
  await putAccountValue(harness, first, ACCOUNT_PATHS.shortcuts, {
    keyboard: 'mac',
    changes: firstShortcuts.shortcuts.mac,
  })
  await expectBoth(firstShortcuts, otherSaved)
  const otherShortcuts: AccountState = {
    ...otherSaved,
    shortcuts: {
      mac: [
        { command: 'command-palette', keys: [readShortcutKeyText('Meta+Y')] },
      ],
      other: [],
    },
  }
  await putAccountValue(harness, other, ACCOUNT_PATHS.shortcuts, {
    keyboard: 'mac',
    changes: otherShortcuts.shortcuts.mac,
  })
  await expectBoth(firstShortcuts, otherShortcuts)
  await harness.env.DB.prepare('UPDATE orgs SET deleted_at = 1 WHERE id = ?')
    .bind(org.id)
    .run()
  expect(
    await (await harness.request(GET_STARTED_PATH, first)).json(),
  ).toMatchObject({ orgId: null })
  expect((await harness.request(ACCOUNT_PATHS.account, '')).status).toBe(401)
}
