import { readFile } from 'node:fs/promises'

import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'

import {
  codexCredentialFile,
  codexTokenFixture,
} from '../../test-support/codex-token'
import { mockComputerServer } from '../../test-support/computer-mcp'
import { deferred } from '../../test-support/runtime'
import { object } from '../parse'
import { createCodexFactory } from './codex'
import {
  writeCodexCredentials,
  type CodexCredentials,
} from './codex-credentials'
import { ProviderLifetime } from './lifetime'
import type { StartProcess } from './process'

beforeEach(mockComputerServer)
afterEach(() => vi.restoreAllMocks())

it('removes a ChatGPT credential file after a failed process start or RPC setup', async () => {
  const h = await codexTokenFixture()
  let directory = ''
  const failedStart: StartProcess = (request) => {
    directory = request.env.CODEX_HOME ?? ''
    throw new Error('App Server start failed')
  }
  await expect(createCodexFactory(failedStart)(h.options)).rejects.toThrow(
    'App Server start failed',
  )
  expect(
    await readFile(codexCredentialFile(directory), 'utf8').catch(() => null),
  ).toBe(null)
  let receive: (line: string) => void = () => {}
  const refusedSetup: StartProcess = (request) => {
    directory = request.env.CODEX_HOME ?? ''
    const port = h.start(request)
    return {
      ...port,
      write: (line) => {
        const input = object(JSON.parse(line))
        queueMicrotask(() =>
          receive(
            JSON.stringify({
              id: input.id,
              error: { code: -32000, message: 'App Server setup failed' },
            }),
          ),
        )
      },
      onLine: (listener) => {
        receive = listener
        port.onLine(listener)
      },
    }
  }
  await expect(createCodexFactory(refusedSetup)(h.options)).rejects.toThrow(
    'App Server setup failed',
  )
  expect(h.servers.latest.closed).toBe(true)
  expect(
    await readFile(codexCredentialFile(directory), 'utf8').catch(() => null),
  ).toBe(null)
})

it('keeps a ChatGPT credential until the stopped process exits and removes it after abort', async () => {
  const h = await codexTokenFixture()
  const provider = await createCodexFactory(h.start)(h.options)
  const file = codexCredentialFile(h.servers.requests[0].env.CODEX_HOME ?? '')
  const exiting = deferred<void>()
  h.servers.latest.closeWait = exiting.promise
  const entered = deferred<void>()
  h.servers.latest.onClosing = () => entered.resolve()
  let stopped = false
  const stopping = provider.stop().then(() => {
    stopped = true
  })
  onTestFinished(async () => {
    exiting.resolve()
    await stopping
  })
  await entered.promise
  expect(await readFile(file, 'utf8')).toContain('sk-gateway-turn-token')
  expect(stopped).toBe(false)
  exiting.resolve()
  await stopping
  expect(stopped).toBe(true)
  expect(await readFile(file, 'utf8').catch(() => null)).toBe(null)

  const controller = new AbortController()
  const active = await createCodexFactory(h.start)({
    ...h.options,
    signal: controller.signal,
  })
  const activeFile = codexCredentialFile(
    h.servers.requests.at(-1)?.env.CODEX_HOME ?? '',
  )
  expect(await readFile(activeFile, 'utf8')).toContain('sk-gateway-turn-token')
  controller.abort()
  await active.close()
  expect(await readFile(activeFile, 'utf8').catch(() => null)).toBe(null)
  expect(h.servers.latest.closed).toBe(true)
})

it('waits for a canceled credential write and removes it before teardown ends', async () => {
  const h = await codexTokenFixture()
  const entered = deferred<CodexCredentials>()
  const release = deferred<void>()
  const lifetime = new ProviderLifetime()
  const controller = new AbortController()
  const factory = createCodexFactory(h.start, async (...args) => {
    const credentials = await writeCodexCredentials(...args)
    entered.resolve(credentials)
    await release.promise
    return credentials
  })
  const opening = factory({ ...h.options, lifetime, signal: controller.signal })
  const credentials = await entered.promise
  controller.abort(new Error('start canceled'))
  let ended = false
  const closing = lifetime.close().then(() => {
    ended = true
  })
  onTestFinished(async () => {
    release.resolve()
    await Promise.allSettled([opening, closing])
  })
  expect(
    await readFile(codexCredentialFile(credentials.directory), 'utf8'),
  ).toContain('sk-gateway-turn-token')
  expect(ended).toBe(false)
  release.resolve()
  await expect(opening).rejects.toThrow('start canceled')
  await closing
  expect(ended).toBe(true)
  expect(h.servers.requests).toEqual([])
  expect(
    await readFile(codexCredentialFile(credentials.directory), 'utf8').catch(
      () => null,
    ),
  ).toBe(null)
  const next = await writeCodexCredentials(
    h.options.home,
    h.options.sessionId,
    'sk-next-turn',
    {
      accountId: 'account',
      email: null,
      planType: null,
      userId: null,
    },
  )
  await lifetime.close()
  expect(await readFile(codexCredentialFile(next.directory), 'utf8')).toContain(
    'sk-next-turn',
  )
  await next.remove()
})
