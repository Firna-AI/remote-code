import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import type { RunnerEvent } from '../../src/shared/generated/RunnerEvent'
import { createHarness, type TestHarness } from '../test-support/harness'
import { createChatFixture, WORKSPACE_ID } from './harness.test-support'
import { captureEnvironment } from './runner-output.test-support'
import {
  refreshCommands,
  refusedEvents,
  workspaceEvents,
} from './runner-repairs.test-support'

let harness: TestHarness
beforeAll(async () => {
  harness = await createHarness()
})
beforeEach(async () => {
  await harness.reset()
})
afterAll(async () => {
  await harness.dispose()
})

it('stores and streams masked bounded port reports to every tab and replays them after restart', async () => {
  const fixture = await createChatFixture(harness)
  await captureEnvironment(fixture, {
    KEY: { value: 'x', secret: true },
    PASSWORD: { value: 'secretpass', secret: true },
    PUBLIC: { value: 'visible', secret: false },
  })
  const first = await fixture.tab()
  const second = await fixture.tab()
  const runner = await fixture.connect()
  const event: RunnerEvent = {
    type: 'ports.updated',
    ports: [
      { port: 3000, name: 'x'.repeat(40), folder: 'x'.repeat(120) },
      {
        port: 3001,
        name: 'development-server-entry-point secretpass',
        folder: `/home/user/code/web/secretpass/${'z'.repeat(115)}`,
      },
      { port: 5173, name: 'visible', folder: null },
    ],
  }
  const sent = runner.emit(event)
  await fixture.drain()
  runner.sendEnvelope(sent)
  await fixture.drain()
  const expected = {
    type: 'ports.updated',
    ports: [
      {
        port: 3000,
        name: '[redacted]'.repeat(4),
        folder: `…${'[redacted]'.repeat(12).slice(-119)}`,
      },
      {
        port: 3001,
        name: 'development-server-entry-point [redacted',
        folder: `…ed]/${'z'.repeat(115)}`,
      },
      { port: 5173, name: 'visible', folder: null },
    ],
  }
  expect(await workspaceEvents(fixture)).toEqual([expected])
  const committed = await fixture.chat.store.read(WORKSPACE_ID, (view) =>
    view.history(0),
  )
  const live = committed.events.map((envelope) => ({ type: 'event', envelope }))
  expect(first.messages.slice(1)).toEqual(live)
  expect(second.messages.slice(1)).toEqual(live)
  expect(await fixture.chat.workspaceSummary()).toEqual({
    throughEventNumber: 1,
    lastOutputEventNumber: 0,
    working: false,
  })
  await fixture.restart()
  const replay = await fixture.tab()
  expect(replay.messages).toEqual([{ type: 'history', history: committed }])
  expect(await refusedEvents(fixture)).toEqual([])
  await first.close()
  await second.close()
  await replay.close()
})

it('refuses invalid port reports and persists one repair until a valid full replacement arrives', async () => {
  const fixture = await createChatFixture(harness)
  await harness.env.DB.prepare('DELETE FROM agent_logins').run()
  const tab = await fixture.tab()
  const runner = await fixture.connect()
  const invalid: RunnerEvent = {
    type: 'ports.updated',
    ports: [{ port: 0, name: null, folder: null }],
  }
  const refused = runner.emit(invalid)
  await fixture.drain()
  const command = refreshCommands(runner)[0]
  expect(command).toEqual({
    type: 'report.refresh',
    commandId: 'chat-0001',
    kind: 'ports.updated',
  })
  expect(await refusedEvents(fixture)).toEqual([
    {
      type: 'runner.event-refused',
      streamId: 'fake-stream-1',
      runnerEventNumber: 1,
      runnerEventType: 'ports.updated',
      reason: 'invalid',
      sessionId: null,
      turnId: null,
    },
  ])
  runner.sendEnvelope(refused)
  await fixture.drain()
  expect(refreshCommands(runner)).toEqual([command])
  await fixture.disconnect(runner)
  await fixture.restart()
  await fixture.connect(runner)
  expect(refreshCommands(runner)).toEqual([command, command])
  runner.emit(invalid)
  await fixture.drain()
  expect((await refusedEvents(fixture)).at(-1)).toEqual({
    type: 'runner.event-refused',
    streamId: 'fake-stream-1',
    runnerEventNumber: 2,
    runnerEventType: 'ports.updated',
    reason: 'invalid',
    sessionId: null,
    turnId: null,
    repairFailed: true,
  })
  await fixture.disconnect(runner)
  await fixture.restart()
  await fixture.connect(runner)
  expect(refreshCommands(runner)).toEqual([command, command])
  const replay = await fixture.tab()
  expect(replay.messages).toEqual([
    {
      type: 'history',
      history: await fixture.chat.store.read(WORKSPACE_ID, (view) =>
        view.history(0),
      ),
    },
  ])
  runner.emit({ type: 'ports.updated', ports: [] })
  await fixture.drain()
  expect(
    await fixture.chat.store.read(WORKSPACE_ID, (view) =>
      view.repairs.get('ports.updated'),
    ),
  ).toBeUndefined()
  runner.emit(invalid)
  await fixture.drain()
  expect(refreshCommands(runner)).toEqual([
    command,
    command,
    { type: 'report.refresh', commandId: 'chat-0002', kind: 'ports.updated' },
  ])
  await tab.close()
  await replay.close()
})
