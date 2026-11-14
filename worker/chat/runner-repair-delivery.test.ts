import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import type { WorkspaceToRunner } from '../../src/shared/generated/WorkspaceToRunner'
import { FakeRunner } from '../test-support/fake-runner'
import { createHarness, type TestHarness } from '../test-support/harness'
import { createChatFixture, WORKSPACE_ID } from './harness.test-support'
import {
  fullReport,
  oversizedReport,
  refreshCommands,
  refusedEvents,
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
it('keeps one repair and refusal after a post-commit crash before the first send', async () => {
  const fixture = await createChatFixture(harness)
  const runner = await fixture.connect()
  await fixture.failNextCommit('after', 'Injected post-commit crash')
  runner.emit(oversizedReport('workspace.title'))
  await expect(fixture.drain()).rejects.toThrow('Injected post-commit crash')
  expect(refreshCommands(runner)).toEqual([])
  expect(runner.pendingEvents().map((event) => event.eventNumber)).toEqual([1])
  await fixture.restart()
  expect(
    await fixture.chat.store.read(WORKSPACE_ID, (view) => view.repairs.all()),
  ).toEqual([
    {
      command: {
        type: 'report.refresh',
        commandId: 'chat-0001',
        kind: 'workspace.title',
      },
      cause: {
        streamId: 'fake-stream-1',
        eventNumber: 1,
        revision: null,
      },
      state: 'pending',
      sent: false,
      replacementRevision: null,
    },
  ])
  await fixture.connect(runner)
  expect(refreshCommands(runner)).toEqual([
    {
      type: 'report.refresh',
      commandId: 'chat-0001',
      kind: 'workspace.title',
    },
  ])
  expect(await refusedEvents(fixture)).toEqual([
    {
      type: 'runner.event-refused',
      streamId: 'fake-stream-1',
      runnerEventNumber: 1,
      runnerEventType: 'workspace.title',
      reason: 'too_large',
      sessionId: null,
      turnId: null,
    },
  ])
  expect(runner.pendingEvents()).toEqual([])
})
it('commits a repair with its refusal and cursor before any send and retries a failed commit', async () => {
  const fixture = await createChatFixture(harness)
  const runner = await fixture.connect()
  await fixture.setStorageHooks({
    beforeCommit: async (staged) => {
      const store = staged
      if (
        (await store.read(WORKSPACE_ID, (view) =>
          view.cursor('fake-stream-1'),
        )) === 1
      )
        throw new Error('Injected storage failure')
    },
  })
  runner.emit(oversizedReport('workspace.title'))
  await expect(fixture.drain()).rejects.toThrow('Injected storage failure')
  expect(refreshCommands(runner)).toEqual([])
  expect(await refusedEvents(fixture)).toEqual([])
  expect(
    await fixture.chat.store.read(WORKSPACE_ID, (view) => view.repairs.all()),
  ).toEqual([])
  expect(runner.pendingEvents().map((event) => event.eventNumber)).toEqual([1])
  await fixture.clearFaults()
  await fixture.restart()
  await fixture.connect(runner)
  expect(refreshCommands(runner).map((command) => command.kind)).toEqual([
    'workspace.title',
  ])
  expect(await refusedEvents(fixture)).toHaveLength(1)
  expect(runner.pendingEvents()).toEqual([])
  runner.emit(fullReport('workspace.title', 2))
  await fixture.drain()
  await fixture.setStorageHooks({
    beforeCommit: async (staged) => {
      const store = staged
      const repair = await store.read(WORKSPACE_ID, (view) =>
        view.repairs.get('workspace.title'),
      )
      if (repair?.cause.eventNumber === 3 && repair.sent)
        throw new Error('Injected delivery commit failure')
    },
  })
  runner.emit(oversizedReport('workspace.title', 3))
  await expect(fixture.drain()).rejects.toThrow(
    'Injected delivery commit failure',
  )
  expect(runner.received.at(-1)).toMatchObject({
    type: 'report.refresh',
    kind: 'workspace.title',
  })
  expect(runner.pendingEvents().map((event) => event.eventNumber)).toEqual([3])
  await fixture.clearFaults()
  await fixture.restart()
  await fixture.connect(runner)
  const requests = refreshCommands(runner)
  expect(requests).toHaveLength(3)
  expect(requests[2]).toEqual(requests[1])
  expect(runner.pendingEvents()).toEqual([])
  expect(await refusedEvents(fixture)).toHaveLength(2)
})
it('redelivers one durable repair after restart between marker commit and first send without confirming early', async () => {
  const fixture = await createChatFixture(harness)
  const runner = await fixture.connect()
  const attempted: WorkspaceToRunner[] = []
  await fixture.setSendRule({
    type: 'report.refresh',
    error: 'Injected refresh send failure',
  })
  fixture.observeOutgoing((message) => {
    if (message.type === 'report.refresh') {
      attempted.push(message)
    }
    return false
  })
  runner.emit(oversizedReport('files.snapshot'))
  await expect(fixture.drain()).rejects.toThrow('Injected refresh send failure')
  expect(runner.received).toEqual([
    {
      type: 'welcome',
      protocolVersion: 2,
      streamId: 'fake-stream-1',
      confirmedThrough: 0,
    },
  ])
  expect(runner.pendingEvents().map((event) => event.eventNumber)).toEqual([1])
  expect(await refusedEvents(fixture)).toHaveLength(1)
  expect(
    await fixture.chat.store.read(WORKSPACE_ID, (view) =>
      view.cursor('fake-stream-1'),
    ),
  ).toBe(1)
  await fixture.setSendRule(null)
  await fixture.restart()
  await fixture.connect(runner)
  expect(runner.received.slice(1)).toEqual([
    {
      type: 'welcome',
      protocolVersion: 2,
      streamId: 'fake-stream-1',
      confirmedThrough: 0,
    },
    ...attempted,
    { type: 'confirm', streamId: 'fake-stream-1', throughEventNumber: 1 },
  ])
  expect(await refusedEvents(fixture)).toHaveLength(1)
  expect(runner.pendingEvents()).toEqual([])
  await fixture.connect(runner)
  expect(refreshCommands(runner)).toEqual([...attempted, ...attempted])
  runner.emit(fullReport('files.snapshot', 2))
  await fixture.drain()
  await fixture.connect(runner)
  expect(refreshCommands(runner)).toEqual([...attempted, ...attempted])
})
it('bounds welcome only for the stream whose repair has not been sent', async () => {
  const fixture = await createChatFixture(harness)
  const second = await fixture.connect(
    new FakeRunner({ workspaceId: WORKSPACE_ID, streamId: 'second' }),
  )
  for (let revision = 1; revision <= 3; revision++)
    second.emit(fullReport('workspace.title', revision))
  await fixture.drain()
  const first = await fixture.connect()
  await fixture.setSendRule({
    type: 'report.refresh',
    error: 'Injected refresh send failure',
  })
  first.emit(oversizedReport('files.snapshot'))
  await expect(fixture.drain()).rejects.toThrow('Injected refresh send failure')
  await expect(fixture.connect(second)).rejects.toThrow(
    'Injected refresh send failure',
  )
  expect(second.received.at(-1)).toEqual({
    type: 'welcome',
    protocolVersion: 2,
    streamId: 'second',
    confirmedThrough: 3,
  })
  expect(first.pendingEvents().map((event) => event.eventNumber)).toEqual([1])
})
