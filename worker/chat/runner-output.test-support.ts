import type { RunnerEvent } from '../../src/shared/generated/RunnerEvent'
import { orgEnvironmentContext } from '../lifecycle/settings-data'
import { encrypt } from '../security/crypto'
import type { TestHarness } from '../test-support/harness'
import {
  createChatFixture,
  WORKSPACE_ID,
  type ChatFixture,
} from './harness.test-support'
import type { ChatFixtureOptions } from './harness.test-support'
export async function captureEnvironment(fixture: ChatFixture, value: unknown) {
  const ciphertext = await encrypt(
    JSON.stringify(value),
    orgEnvironmentContext(fixture.org.id),
    fixture.env.BOAT_KEY_ENCRYPTION_KEY,
  )
  await fixture.env.DB.prepare(
    `INSERT INTO workspace_runtime
     (workspace_id, org_id, created_by_user_id, session_id, first_turn_id,
      environment_ciphertext, agent, model, effort, first_message_id)
     VALUES (?, ?, ?, 'unused', 'unused', ?, 'claude', 'test', 'high', 'unused')
     ON CONFLICT(workspace_id) DO UPDATE SET environment_ciphertext = excluded.environment_ciphertext`,
  )
    .bind(WORKSPACE_ID, fixture.org.id, fixture.owner.id, ciphertext)
    .run()
}
export async function outputFixture(
  harness: TestHarness,
  environment: unknown,
  overrides: ChatFixtureOptions = {},
) {
  const fixture = await createChatFixture(harness, overrides)
  await captureEnvironment(fixture, environment)
  const session = await fixture.createSession()
  const runner = await fixture.connect()
  runner.emit({ type: 'runner.ready' })
  await fixture.drain()
  await fixture.send(session.id)
  const command = runner.commands.find((command) => command.type === 'turn')
  if (command?.type !== 'turn') throw new Error('Expected a turn.')
  const context = { sessionId: session.id, turnId: command.turnId }
  runner.emit({
    type: 'turn.started',
    ...context,
    senderId: fixture.owner.id,
    choice: command.message.choice,
    startedAt: 25,
    messageIds: [command.message.id],
  })
  await fixture.drain()
  return {
    ...fixture,
    runner,
    context,
    messageId: command.message.id,
    emit: async (event: RunnerEvent) => {
      const envelope = runner.emit(event)
      await fixture.drain()
      return envelope
    },
  }
}
