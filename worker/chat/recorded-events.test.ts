import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AgentChatEvent } from '../../src/shared/generated/AgentChatEvent'
import type { ChatEvent } from '../../src/shared/chat-events'
import { sessionPaths } from '../../src/shared/sessions'
import { recordedChatEvents } from '../../src/test-support/recorded-chat'
import { createHarness, type TestHarness } from '../test-support/harness'
import { CLAUDE, createChatFixture, WORKSPACE_ID } from './harness.test-support'
describe('workspace chat recorded events', () => {
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
  it('stores provider-neutral partial text, tools, completion, stop, and failure', async () => {
    const fixture = await createChatFixture(harness)
    const read = {
      type: 'file.read' as const,
      requestId: 'read-result',
      path: 'README.md',
      maxBytes: 1024,
    }
    expect(await fixture.sendFileCommand(WORKSPACE_ID, read)).toBe(false)
    const runner = await fixture.connect()
    expect(await fixture.sendFileCommand(WORKSPACE_ID, read)).toBe(false)
    runner.emit({ type: 'runner.ready' })
    await fixture.drain()
    expect(await fixture.sendFileCommand(WORKSPACE_ID, read)).toBe(true)
    expect(runner.commands).toEqual([read])
    runner.reply({
      type: 'file.read.result',
      requestId: 'read-result',
      result: {
        ok: true,
        file: {
          path: 'README.md',
          mediaType: 'text/plain',
          sizeBytes: 4,
          encoding: 'utf-8',
          content: 'Read',
        },
      },
    })
    await fixture.drain()
    expect(
      await fixture.chat.store.read(WORKSPACE_ID, (view) => view.history(0)),
    ).toEqual({ events: [], throughEventNumber: 0 })
    expect(
      await fixture.chat.store.read(WORKSPACE_ID, (view) => view.pending()),
    ).toEqual([])
    await fixture.setSendRule({
      type: 'file.read',
      error: 'Injected file transport failure',
    })
    expect(await fixture.sendFileCommand(WORKSPACE_ID, read)).toBe(false)
    await fixture.setSendRule(null)
    await fixture.connect(runner)
    expect(runner.commands).toEqual([read])
    expect(
      await fixture.chat.store.read(WORKSPACE_ID, (view) => view.pending()),
    ).toEqual([])
    for (const scenario of [
      'history',
      'interrupted',
      'failed',
      'omitted-data',
    ] as const) {
      const session = await fixture.createSession()
      const messageId = `ask-${scenario}`
      await fixture.send(session.id, messageId)
      const command = runner.commands.at(-1)
      if (command?.type !== 'turn') throw new Error('Expected a turn.')
      const expected: ChatEvent[] = []
      for (const { event } of recordedChatEvents(
        scenario,
        WORKSPACE_ID,
        session.id,
      )) {
        if (event.type === 'turn.stop-requested') {
          await fixture.fetch(
            sessionPaths.interrupt(fixture.org.id, WORKSPACE_ID, session.id),
            { turnId: command.turnId },
            fixture.memberCookie,
          )
          expected.push({
            type: 'turn.stop-requested',
            sessionId: session.id,
            turnId: command.turnId,
            requestedById: fixture.member.id,
          })
          continue
        }
        if (
          !('turnId' in event) ||
          event.type === 'message.sent' ||
          event.type === 'runner.event-refused'
        )
          continue
        const normalized: AgentChatEvent = { ...event, turnId: command.turnId }
        if (normalized.type === 'turn.started') {
          normalized.senderId = fixture.owner.id
          normalized.choice = CLAUDE
          normalized.messageIds = [messageId]
        }
        if (
          normalized.type === 'assistant.completed' ||
          normalized.type === 'turn.completed'
        )
          normalized.userMessageIds = [messageId]
        if (normalized.type === 'turn.failed')
          normalized.retryMessageId = messageId
        expected.push(structuredClone(normalized))
        runner.emit(
          Object.assign(normalized, { sdkOnly: 'must-not-be-stored' }),
        )
      }
      await fixture.drain()
      const history = await fixture.history(session.id)
      expect(
        history.events
          .map(({ event }) => event)
          .filter(
            (event) => 'turnId' in event && event.type !== 'message.sent',
          ),
        scenario,
      ).toEqual(
        {
          history: [
            expected[0],
            expected[1],
            { ...expected[2], text: '' },
            expected[4],
            expected[5],
            expected[6],
            expected[7],
          ],
          interrupted: expected,
          failed: expected,
          'omitted-data': expected,
        }[scenario],
      )
      expect(JSON.stringify(history), scenario).not.toContain(
        'must-not-be-stored',
      )
    }
  })
})
