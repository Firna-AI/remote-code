import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import type { RunnerProtocolVersion } from '../../src/shared/generated/RunnerProtocolVersion'
import { agentLoginPath } from '../../src/shared/account'
import type { ChatHistoryResponse } from '../chat/workspace-events'
import { RUNNER_SUPPORTED_LOGIN_KINDS } from '../../src/shared/runner'
import {
  CLAUDE,
  createChatFixture,
  WORKSPACE_ID,
  type ChatFixture,
} from '../chat/harness.test-support'
import { agentLoginContext } from '../chat/queries'
import { encrypt } from '../security/crypto'
import { TEST_TIME, type TestHarness } from '../test-support/harness'
import { FakeRunner } from '../test-support/fake-runner'
import { codexTestTokens } from './codex-login.test-support'

export async function runningGatewayTurn(
  harness: TestHarness,
  choice: AgentChoice = CLAUDE,
  options: {
    protocolVersion?: RunnerProtocolVersion
    kind?: 'api-key' | 'token' | 'endpoint'
    secret?: string
    endpoint?: string
  } = {},
) {
  const fixture = await createChatFixture(harness)
  if (options.kind === 'token')
    await fixture.env.DB.prepare(
      'UPDATE agent_logins SET kind = ? WHERE user_id = ? AND agent = ?',
    )
      .bind(options.kind, fixture.member.id, choice.agent)
      .run()
  if (options.kind === 'endpoint') {
    const saved = await harness.request(
      agentLoginPath(choice.agent),
      fixture.memberCookie,
      {
        method: 'PUT',
        body: JSON.stringify({
          agent: choice.agent,
          kind: 'endpoint',
          endpoint: options.endpoint ?? gatewayOwnEndpoint,
          secret:
            options.secret ?? `secret-${fixture.member.id}-${choice.agent}`,
        }),
      },
    )
    if (saved.status !== 200)
      throw new Error('The endpoint login was not saved.')
  }
  if (options.kind === 'token' && choice.agent === 'codex')
    await fixture.env.DB.prepare(
      'UPDATE agent_logins SET ciphertext = ? WHERE user_id = ? AND agent = ?',
    )
      .bind(
        await encrypt(
          JSON.stringify(codexTestTokens(`secret-${fixture.member.id}-codex`)),
          agentLoginContext(fixture.member.id, 'codex'),
          fixture.env.BOAT_KEY_ENCRYPTION_KEY,
        ),
        fixture.member.id,
        'codex',
      )
      .run()
  const session = await fixture.createSession(choice, fixture.memberCookie)
  const runner = await fixture.connect(
    new FakeRunner({
      workspaceId: WORKSPACE_ID,
      protocolVersion: options.protocolVersion,
      loginKinds: RUNNER_SUPPORTED_LOGIN_KINDS,
    }),
  )
  runner.emit({ type: 'runner.ready' })
  await fixture.drain()
  await fixture.send(session.id, 'gateway-message', fixture.ownerCookie, choice)
  const turn = runner.commands.find(
    (command) =>
      command.type === 'turn' && command.message.id === 'gateway-message',
  )
  if (turn?.type !== 'turn') throw new Error('The gateway turn is missing.')
  const issue = () => issueGatewayToken(fixture, turn.turnId)
  const token = await issue()
  if (!token) throw new Error('The running turn has no token.')
  return {
    fixture,
    session,
    runner,
    turn,
    token,
    issue,
    check: (value = token) =>
      fixture.chat.turnTokens.check(WORKSPACE_ID, value),
  }
}

export function issueGatewayToken(fixture: ChatFixture, turnId: string) {
  return fixture.chat.runLifecycle(() =>
    fixture.chat.turnTokens.forRunningTurn(WORKSPACE_ID, turnId),
  )
}

export async function replaceGatewayLogin(fixture: ChatFixture) {
  await fixture.env.DB.prepare(
    `UPDATE agent_logins SET ciphertext = ?, updated_at = ?
     WHERE user_id = ? AND agent = 'claude'`,
  )
    .bind(
      await encrypt(
        ' new-login\n',
        agentLoginContext(fixture.member.id, 'claude'),
        fixture.env.BOAT_KEY_ENCRYPTION_KEY,
      ),
      TEST_TIME + 1,
      fixture.member.id,
    )
    .run()
}

export function turnEnds(history: ChatHistoryResponse) {
  return history.events.filter(
    ({ event, late }) =>
      !late &&
      (event.type === 'turn.failed' || event.type === 'turn.completed'),
  )
}

export const gatewayOwnEndpoint =
  'https://proxy.example.test:8443/private/v1?key=value'
