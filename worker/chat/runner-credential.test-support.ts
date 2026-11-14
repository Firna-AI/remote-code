import type { Miniflare } from 'miniflare'
import { expect } from 'vitest'
import type { RunnerCommand } from '../../src/shared/generated/RunnerCommand'
import type { Workspace } from '../workspace'
import type { ChatFixture } from './harness.test-support'
import { WORKSPACE_ID } from './harness.test-support'
import { record, string } from './inputs'
import type { AgentLoginKind } from './login-kind'

export async function expectGatewayLogin(
  fixture: Pick<ChatFixture, 'chat'>,
  command: RunnerCommand | undefined,
  secret: string,
  kind?: AgentLoginKind,
): Promise<void> {
  if (command?.type !== 'turn' && command?.type !== 'message')
    throw new Error('The message command is missing.')
  expect(command).not.toHaveProperty('login')
  const token =
    command.type === 'turn'
      ? command.credential.token
      : await fixture.chat.turnTokens.forRunningTurn(
          WORKSPACE_ID,
          command.turnId,
        )
  expect(token).toMatch(/^sk-/)
  expect(
    await fixture.chat.turnTokens.check(WORKSPACE_ID, token ?? ''),
  ).toMatchObject({
    ok: true,
    login: { secret, ...kind },
  })
  expect('credential' in command).toBe(command.type === 'turn')
}

export async function expectSocketGatewayLogin(
  runtime: Miniflare,
  workspaceId: string,
  command: unknown,
  secret: string,
): Promise<void> {
  const turn = record(command)
  expect(turn.type).toBe('turn')
  expect(turn).not.toHaveProperty('login')
  const token = string(record(turn.credential).token)
  expect(token).toMatch(/^sk-/)
  const bindings = await runtime.getBindings<{
    WORKSPACES: DurableObjectNamespace<Workspace>
  }>()
  const call = bindings.WORKSPACES.getByName(workspaceId).checkTurnToken(token)
  try {
    const result = await call
    try {
      expect(result).toMatchObject({ ok: true, login: { secret } })
    } finally {
      disposeRpc(result)
    }
  } finally {
    disposeRpc(call)
  }
}

function disposeRpc(value: object): void {
  const dispose: unknown = Reflect.get(value, Symbol.dispose)
  if (typeof dispose === 'function') Reflect.apply(dispose, value, [])
}
