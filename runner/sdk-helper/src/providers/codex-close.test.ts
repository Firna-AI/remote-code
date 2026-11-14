import { beforeEach, expect, it, onTestFinished } from 'vitest'

import { FakeAppServers } from '../../test-support/app-server'
import { mockComputerServer } from '../../test-support/computer-mcp'
import { turn } from '../../test-support/input'
import { providerFixture } from '../../test-support/fixture'
import { fakeToolContext } from '../../test-support/input'
import { createCodexFactory } from './codex'

beforeEach(mockComputerServer)

it('waits for Codex process exit before stop returns', async () => {
  const h = await providerFixture()
  const servers = new FakeAppServers()
  const direct = await createCodexFactory(servers.start)({
    cwd: h.root,
    home: h.home,
    sessionId: turn('close', 'bob', 'codex').sessionId,
    endpoint:
      fakeToolContext.machineOrigin +
      '/v1/model/' +
      turn('close', 'bob', 'codex').message.choice.agent,
    credential: {
      type: 'gateway',
      ...turn('close', 'bob', 'codex').credential,
    },
    commitAuthor: null,
    choice: {
      agent: 'codex',
      model: 'test-model',
      effort: 'high',
      fast: false,
    },
    conversationId: null,
    instructions: '',
    tools: fakeToolContext,
    event: () => {},
    warn: h.options.warn,
  })
  const closing = servers.latest
  const order: string[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  closing.closeWait = gate.then(() => {
    order.push('closed')
  })
  let requested: () => void = () => {}
  const started = new Promise<void>((resolve) => {
    requested = resolve
  })
  closing.onClosing = () => {
    order.push('requested')
    requested()
  }
  onTestFinished(() => {
    release()
    return direct.close()
  })
  const stopped = direct.stop().then(() => {
    order.push('returned')
  })
  await started
  order.push('release')
  release()
  await stopped
  expect(order).toEqual(['requested', 'release', 'closed', 'returned'])
})
