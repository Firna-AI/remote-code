import type { RunnerEvent } from '../../src/shared/generated/RunnerEvent'
import { sessionsPath, sessionPaths } from '../../src/shared/sessions'
import { record } from '../chat/inputs'
import { FIRST_MESSAGE } from './durable-test-support'
import type { realRuntimeFixture } from './real-runtime-test-support'

export async function connectRuntimeChat(
  fixture: Awaited<ReturnType<typeof realRuntimeFixture>>,
  workspaceId: string,
) {
  const actor = fixture.actor(workspaceId)
  const runner = await fixture.openRunner(workspaceId)
  let eventNumber = 0
  runner.send({
    type: 'hello',
    protocolVersion: 2,
    workspaceId,
    streamId: 'runtime-state-stream',
  })
  if (record(await runner.inbox.next()).type !== 'welcome')
    throw new Error('The runtime runner welcome is missing.')
  const emit = async (event: RunnerEvent) => {
    runner.send({
      type: 'event',
      streamId: 'runtime-state-stream',
      eventNumber: ++eventNumber,
      occurredAt: Date.now(),
      event,
    })
    const confirm = record(await runner.inbox.next())
    if (
      confirm.type !== 'confirm' ||
      confirm.throughEventNumber !== eventNumber
    )
      throw new Error('The runtime runner confirm is missing.')
  }
  const acknowledge = async (suffix: string) => {
    const command = record(await runner.inbox.next())
    if (command.type !== 'turn' || command.turnId !== `turn-${suffix}`)
      throw new Error('The runtime turn command is missing.')
    await emit({
      type: 'turn.started',
      sessionId: `session-${suffix}`,
      turnId: `turn-${suffix}`,
      senderId: 'runtime-user',
      choice: FIRST_MESSAGE.choice,
      startedAt: Date.now(),
      messageIds: [suffix === 'one' ? FIRST_MESSAGE.id : `message-${suffix}`],
    })
    await actor.readLifecycle()
  }
  await emit({ type: 'runner.ready' })
  await acknowledge('one')
  return {
    startTurn: async (suffix: string) => {
      await actor.nextChatIds([`session-${suffix}`])
      const session = await fixture.request(
        sessionsPath('runtime-org', workspaceId),
        {
          choice: FIRST_MESSAGE.choice,
        },
      )
      if (session.status !== 201)
        throw new Error('The runtime session was refused.')
      await actor.nextChatIds([`turn-${suffix}`, `command-${suffix}`])
      const message = await fixture.request(
        sessionPaths.messages('runtime-org', workspaceId, `session-${suffix}`),
        { ...FIRST_MESSAGE, id: `message-${suffix}` },
      )
      if (message.status !== 202)
        throw new Error('The runtime message was refused.')
      await acknowledge(suffix)
    },
    finishTurn: async (suffix: string) => {
      await emit({
        type: 'turn.completed',
        sessionId: `session-${suffix}`,
        turnId: `turn-${suffix}`,
        state: 'finished',
        durationMs: 1,
        files: [],
        omittedFileCount: 0,
        userMessageIds: [
          suffix === 'one' ? FIRST_MESSAGE.id : `message-${suffix}`,
        ],
      })
      await actor.readLifecycle()
    },
  }
}
