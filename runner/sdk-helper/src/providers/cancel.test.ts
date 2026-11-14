import { beforeEach, expect, it } from 'vitest'

import { FakeAppServers } from '../../test-support/app-server'
import { mockComputerServer } from '../../test-support/computer-mcp'
import { turn } from '../../test-support/input'
import { fakeToolContext } from '../../test-support/input'
import { deferred } from '../../test-support/runtime'
import { providerFixture } from '../../test-support/fixture'
import { object } from '../parse'
import { createCodexFactory } from './codex'
import type { ProcessRequest, StartProcess } from './process'
import type { ProviderProcess } from './types'

beforeEach(mockComputerServer)

it('closes Codex startup and in-flight requests when their session signal is canceled', async () => {
  const h = await providerFixture()
  for (const method of [
    'initialize',
    'account/login/start',
    'turn/start',
    'turn/steer',
  ]) {
    const controller = new AbortController()
    const entered = deferred<ProcessRequest>()
    const servers = new FakeAppServers()
    let held = ''
    let releaseHeld: () => void = () => {}
    const start: StartProcess = (request) => {
      const server = servers.start(request)
      releaseHeld = () => server.write(held)
      return {
        write: (line) => {
          if (object(JSON.parse(line)).method === method) {
            held = line
            entered.resolve(request)
          } else server.write(line)
        },
        onLine: (listener) => server.onLine(listener),
        onExit: (listener) => server.onExit(listener),
        close: () => server.close(),
      }
    }
    let provider: ProviderProcess | null = null
    const opening = createCodexFactory(start)({
      cwd: h.root,
      home: h.home,
      sessionId: turn().sessionId,
      endpoint:
        fakeToolContext.machineOrigin +
        '/v1/model/' +
        turn().message.choice.agent,
      credential: { type: 'gateway', ...turn().credential },
      commitAuthor: null,
      choice: turn().message.choice,
      conversationId: null,
      instructions: '',
      tools: fakeToolContext,
      event: () => {},
      warn: () => {},
      signal: controller.signal,
    })
    let request: Promise<void> | null = null
    if (method !== 'initialize' && method !== 'account/login/start') {
      provider = await opening
      if (method === 'turn/steer') await provider.send(turn())
      request = provider.send(turn('held'))
    }
    const processRequest = await entered.promise
    try {
      expect(processRequest.signal).toBe(controller.signal)
      controller.abort()
      await expect(request ?? opening).rejects.toThrow(
        'The agent process ended.',
      )
      expect(servers.latest.closed).toBe(true)
    } finally {
      if (!controller.signal.aborted) releaseHeld()
      try {
        provider = await opening
        await request
      } catch {
        /* Cancellation is asserted above. */
      }
      await provider?.close()
    }
  }
})
