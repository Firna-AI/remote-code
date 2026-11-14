import { afterEach, beforeAll, expect, it } from 'vitest'

import {
  DEVICE_COMMAND_PATH,
  deviceCommandsPath,
} from '../../../src/shared/device'
import {
  workspacePath,
  workspacePaths,
  workspacesPath,
} from '../../../src/shared/workspaces'
import { TOOL_TURN_HEADER } from '../../../src/shared/agent-tools'
import { deleteOrgPath } from '../../../src/shared/orgs'
import { listToolWorkspaces } from '../../tools/workspace-data'
import { closeSockets } from '../adapter-sockets.test-support'
import { array } from '../agent-events'
import { record } from '../inputs'
import {
  outerWorkerBundle,
  OUTER_MACHINE_ORIGIN,
} from './outer-runtime.test-support'
import {
  OUTER_ORG,
  OUTER_TOKEN,
  OUTER_WORKSPACE,
} from './outer-seed.test-support'
import {
  reviewWorkspaceFixture,
  type ReviewWorkspaceFixture,
} from './workspace-review.test-support'

let bundle: string
let fixture: ReviewWorkspaceFixture | undefined
beforeAll(async () => {
  bundle = await outerWorkerBundle(
    'worker/chat/integration/workspace-review-entry.test-support.ts',
  )
})

afterEach(async () => {
  await fixture?.dispose()
  fixture = undefined
})

it('keeps current Mac input across lifecycle activity, heartbeat, retained return and later turn resolution', async () => {
  const active = (fixture = await reviewWorkspaceFixture(bundle))
  const mac = await active.connectMac()
  const tab = await active.browser()
  const before = await active.actor().readChatWorkspaceSummary()
  const requested = await active.runtime.dispatchFetch(
    `${OUTER_MACHINE_ORIGIN}${DEVICE_COMMAND_PATH}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OUTER_TOKEN}`,
        [TOOL_TURN_HEADER]: 'first-turn',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requestId: 'projection-request',
        command: 'echo projection',
        folder: '/Users/owner/project',
        reason: 'Check a local result',
      }),
    },
  )
  expect(requested.status).toBe(202)
  expect(await requested.json()).toMatchObject({
    request: { state: 'waiting' },
  })
  expect(await mac.inbox.next()).toMatchObject({
    type: 'command.request',
    request: { requestId: 'projection-request' },
  })
  expect(await active.actor().readChatWorkspaceSummary()).toMatchObject({
    throughEventNumber: before.throughEventNumber + 1,
  })
  expect(await tab.inbox.next()).toMatchObject({
    type: 'event',
    envelope: {
      event: { type: 'workspace.updated', workspace: { state: 'input' } },
    },
  })
  const activity = await active.request(
    workspacePaths.activity(OUTER_ORG, OUTER_WORKSPACE),
    { method: 'POST', body: JSON.stringify({ source: 'input' }) },
  )
  expect(activity.status).toBe(200)
  expect(
    await active.env.DB.prepare('SELECT state FROM workspaces WHERE id = ?')
      .bind(OUTER_WORKSPACE)
      .first('state'),
  ).toBe('input')
  await active
    .actor()
    .lifecycleStep('during-device', 'Updating start steps', 'running')
  expect(
    await active.env.DB.prepare('SELECT state FROM workspaces WHERE id = ?')
      .bind(OUTER_WORKSPACE)
      .first('state'),
  ).toBe('input')
  const deadlines = active.boat.deadlineIds.length
  await active.actor().advanceStartAlarm()
  expect(active.boat.deadlineIds.length).toBeGreaterThan(deadlines)
  expect(
    (
      await listToolWorkspaces(
        active.env.DB,
        OUTER_ORG,
        active.env.APP_ORIGIN,
        {},
      )
    ).workspaces.find((workspace) => workspace.id === OUTER_WORKSPACE)?.state,
  ).toBe('input')
  const listed = await active.request(workspacesPath(OUTER_ORG))
  expect(listed.status).toBe(200)
  expect(
    array(record(await listed.json()).workspaces, record).find(
      (workspace) => workspace.id === OUTER_WORKSPACE,
    )?.state,
  ).toBe('input')
  const cursor = (await active.actor().readChatWorkspaceSummary())
    .throughEventNumber
  await closeSockets(tab.socket)
  const reopened = await active.request(
    workspacePath(OUTER_ORG, OUTER_WORKSPACE),
  )
  expect(reopened.status).toBe(200)
  expect(await reopened.json()).toMatchObject({ workspace: { state: 'input' } })
  const retained = await active.browser(cursor)
  expect(retained.history).toMatchObject({
    throughEventNumber: cursor,
    events: [],
  })
  active.runner.emit({
    type: 'turn.completed',
    sessionId: 'first-session',
    turnId: 'first-turn',
    state: 'finished',
    durationMs: 1,
    files: [],
    omittedFileCount: 0,
    userMessageIds: ['first-message'],
  })
  expect(await active.runner.inbox.next()).toMatchObject({
    type: 'confirm',
    throughEventNumber: 2,
  })
  const records = await active.request(
    deviceCommandsPath(OUTER_ORG, OUTER_WORKSPACE),
  )
  expect(records.status).toBe(200)
  expect(await records.json()).toMatchObject({
    requests: [
      {
        requestId: 'projection-request',
        state: 'failed',
        error: { code: 'turn_ended' },
      },
    ],
  })
  expect(
    await active.env.DB.prepare('SELECT state FROM workspaces WHERE id = ?')
      .bind(OUTER_WORKSPACE)
      .first('state'),
  ).toBe('ready')
})

it('cancels a pending Mac request before org deletion finishes without projecting into the deleted org', async () => {
  const active = (fixture = await reviewWorkspaceFixture(bundle))
  const mac = await active.connectMac()
  const requested = await active.runtime.dispatchFetch(
    `${OUTER_MACHINE_ORIGIN}${DEVICE_COMMAND_PATH}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OUTER_TOKEN}`,
        [TOOL_TURN_HEADER]: 'first-turn',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requestId: 'deleted-org-request',
        command: 'echo pending',
        folder: '/Users/owner/project',
        reason: 'Check deletion cleanup',
      }),
    },
  )
  expect(requested.status).toBe(202)
  expect(await mac.inbox.next()).toMatchObject({
    type: 'command.request',
    request: { requestId: 'deleted-org-request' },
  })
  const deleted = await active.request(deleteOrgPath(OUTER_ORG), {
    method: 'POST',
    body: JSON.stringify({ name: 'Chat org' }),
  })
  expect(deleted.status).toBe(200)
  expect(await mac.inbox.next()).toMatchObject({
    type: 'command.cancel',
    requestId: 'deleted-org-request',
    workspaceId: OUTER_WORKSPACE,
  })
  expect(
    await active.actor().deviceOperation(OUTER_WORKSPACE, {
      type: 'workspace.validate',
      requestId: 'deleted-org-request',
      tokenHash: 'ignored-ended-request',
    }),
  ).toEqual({ ok: true, value: { valid: false, reason: 'request_ended' } })
})
