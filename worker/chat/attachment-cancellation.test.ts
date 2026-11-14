import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import type { SendMessageResponse } from '../../src/shared/messages'
import { retryMessagePath } from '../../src/shared/sessions'
import {
  TEST_TIME,
  createHarness,
  type TestHarness,
} from '../test-support/harness'
import { FakeRunner } from '../test-support/fake-runner'
import { attachmentFixture } from './attachment.test-support'
import { WORKSPACE_ID } from './harness.test-support'
import {
  lifecycleSnapshot,
  messageCommands,
  startTurn,
  terminalEvent,
} from './turn-lifecycle.test-support'
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
it('sends copy-failure cancellation before Try again without waiting for the old turn end', async () => {
  let fail = true
  const fixture = await attachmentFixture(harness, {
    attachmentSandboxId: async () => 'sandbox-cancellation',
    prepareAttachments: async () => {
      if (fail) throw new Error('An injected copy failure')
      return 'sandbox-cancellation'
    },
  })
  const file = await fixture.upload()
  const session = await fixture.createSession()
  const runner = await fixture.connect(
    new FakeRunner({ workspaceId: WORKSPACE_ID, protocolVersion: 2 }),
  )
  runner.emit({ type: 'runner.ready' })
  await fixture.drain()
  try {
    const original = await startTurn(fixture, runner, session.id, 'live-start')
    expect(
      (await fixture.sendAttachment(session.id, 'live-file', [file.id])).status,
    ).toBe(202)
    await fixture.drainAttachments()
    fail = false
    const response = await fixture.fetch(
      retryMessagePath(fixture.org.id, WORKSPACE_ID, session.id, 'live-file'),
      {},
    )
    expect(response.status).toBe(202)
    const retry: SendMessageResponse = await response.json()
    await fixture.drainAttachments()
    expect(runner.commands.map((command) => command.type)).toEqual([
      'turn',
      'interrupt',
      'turn',
    ])
    expect(messageCommands(runner, retry.message.id)).toMatchObject([
      { type: 'turn', message: { id: retry.message.id } },
    ])
    const retryCommand = messageCommands(runner, retry.message.id)[0]
    if (retryCommand?.type !== 'turn')
      throw new Error('The retry turn is missing.')
    runner.emit({
      type: 'turn.started',
      sessionId: session.id,
      turnId: retryCommand.turnId,
      senderId: fixture.owner.id,
      choice: retryCommand.message.choice,
      startedAt: TEST_TIME,
      messageIds: [retry.message.id],
    })
    runner.emit(terminalEvent(original, 'stopped'))
    await fixture.drain()
    expect(
      await fixture.chat.store.read(WORKSPACE_ID, (view) =>
        view.turn(original.turnId),
      ),
    ).toMatchObject({ state: 'failed' })
    expect(
      await fixture.chat.store.read(WORKSPACE_ID, (view) =>
        view.session(session.id),
      ),
    ).toMatchObject({
      activeTurnId: retry.session.activeTurnId,
      retryMessageId: null,
    })
    expect(
      await fixture.chat.store.read(WORKSPACE_ID, (view) => view.pending()),
    ).toEqual([])
  } finally {
    runner.disconnect()
  }
})
it('replays stored copy-failure interrupts after restart and clears only the matching late end', async () => {
  const fixture = await attachmentFixture(harness, {
    prepareAttachments: async () => {
      throw new Error('An injected copy failure')
    },
  })
  const file = await fixture.upload()
  const first = await fixture.createSession()
  const second = await fixture.createSession()
  const runner = await fixture.connect()
  try {
    runner.emit({ type: 'runner.ready' })
    await fixture.drain()
    const firstTurn = await startTurn(fixture, runner, first.id, 'first-start')
    const secondTurn = await startTurn(
      fixture,
      runner,
      second.id,
      'second-start',
    )
    await fixture.setSendRule({ type: 'interrupt', drop: true })
    for (const [sessionId, messageId] of [
      [first.id, 'first-failed-file'],
      [second.id, 'second-failed-file'],
    ]) {
      expect(
        (await fixture.sendAttachment(sessionId, messageId, [file.id])).status,
      ).toBe(202)
      await fixture.drainAttachments()
    }
    const interrupts = await fixture.chat.store.read(
      WORKSPACE_ID,
      async (view) =>
        (await view.pending()).filter(
          (command) => command.type === 'interrupt',
        ),
    )
    expect(interrupts).toMatchObject([
      { type: 'interrupt', sessionId: first.id, turnId: firstTurn.turnId },
      { type: 'interrupt', sessionId: second.id, turnId: secondTurn.turnId },
    ])
    const secondInterrupt = interrupts[1]
    if (!secondInterrupt) throw new Error('The second cancellation is missing.')
    runner.disconnect()
    await fixture.restart()
    await fixture.setSendRule(null)
    await fixture.connect(runner)
    await fixture.drainAttachments()
    expect(
      runner.commands.filter((command) => command.type === 'interrupt'),
    ).toEqual(interrupts)
    const before = await lifecycleSnapshot(fixture)
    runner.emit({
      type: 'assistant.delta',
      sessionId: first.id,
      turnId: firstTurn.turnId,
      messageId: 'late-copy-answer',
      text: 'The failure already ended this turn.',
    })
    await fixture.drain()
    expect(await lifecycleSnapshot(fixture)).toEqual(before)
    const completed = runner.emit(terminalEvent(firstTurn, 'stopped'))
    await fixture.drain()
    expect(await lifecycleSnapshot(fixture)).toEqual({
      ...before,
      commands: [secondInterrupt],
    })
    const history = await fixture.history(first.id)
    expect(history.events.at(-1)).toMatchObject({
      late: true,
      event: completed.event,
    })
    runner.sendEnvelope(completed)
    await fixture.drain()
    expect(await fixture.history(first.id)).toEqual(history)
    runner.emit(terminalEvent(secondTurn, 'stopped'))
    await fixture.drain()
    expect(
      await fixture.chat.store.read(WORKSPACE_ID, (view) => view.pending()),
    ).toEqual([])
  } finally {
    runner.disconnect()
  }
})
