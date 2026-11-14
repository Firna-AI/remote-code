import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'

import { FakeChild } from '../../test-support/child'
import { FakeClaudeQuery } from '../../test-support/claude-query'
import { mockComputerServer } from '../../test-support/computer-mcp'
import { providerFixture } from '../../test-support/fixture'
import { turn } from '../../test-support/input'
import { deferred } from '../../test-support/runtime'
import { createClaudeFactory, type ClaudeQueryFactory } from './claude'
import { createCodexFactory } from './codex'

beforeEach(mockComputerServer)

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}))

async function fixture(child: FakeChild) {
  vi.mocked(spawn).mockReturnValue(child)
  const directory = await mkdtemp(join(tmpdir(), 'conductive-lifetime-'))
  const sdk = new FakeClaudeQuery()
  const start: ClaudeQueryFactory = (parameters) => {
    const options = {
      command: '/fake/claude',
      args: [],
      cwd: directory,
      env: {},
      signal: new AbortController().signal,
    }
    if (parameters.options?.spawnClaudeCodeProcess)
      parameters.options.spawnClaudeCodeProcess(options)
    else spawn(options.command, options.args)
    return sdk.open(parameters)
  }
  const h = await providerFixture()
  const factory = {
    claude: createClaudeFactory(start, () => '/fake/claude'),
    codex: createCodexFactory(),
  }
  const options = { ...h.options, home: directory }
  onTestFinished(async () => {
    try {
      child.exit()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  return { ...h, sdk, factory, options }
}

it('holds Claude close and credentials until its child exits', async () => {
  const child = new FakeChild()
  const h = await fixture(child)
  const provider = await h.factory.claude(h.options)
  onTestFinished(() => provider.close())
  await provider.send(turn())
  const credentials = join(
    h.options.home,
    '.conductive',
    'anthropic',
    'credentials',
  )
  const profiles = await readdir(credentials)
  expect(profiles).toHaveLength(1)
  const user = await h.sdk.nextUser()
  const requested = deferred<void>()
  child.onKill = () => requested.resolve()
  await h.sdk.raw({
    type: 'result',
    subtype: 'success',
    is_error: false,
    user_message_uuids: [user.uuid],
  })
  const ending = provider.close()
  try {
    await Promise.race([requested.promise, ending])
    expect(child.exitCode).toBe(null)
    expect(child.signals).toEqual(['SIGTERM'])
    expect(await readdir(credentials)).toEqual(profiles)
  } finally {
    child.exit()
    await ending
  }
  expect(child.exitCode).toBe(0)
  expect(await readdir(credentials)).toEqual([])
})

it('kills a stuck process at the approved limit before provider stop returns', async () => {
  const child = new FakeChild()
  child.rpc = true
  child.exitOnSignal = 'SIGKILL'
  const h = await fixture(child)
  const provider = await h.factory.codex({
    ...h.options,
    credential: { type: 'gateway', ...turn('1', 'alice', 'codex').credential },
    choice: turn('1', 'alice', 'codex').message.choice,
  })
  onTestFinished(() => provider.close())
  const requested = deferred<void>()
  child.onKill = () => requested.resolve()
  vi.useFakeTimers()
  const ending = provider.stop()
  try {
    await requested.promise
    await vi.advanceTimersByTimeAsync(4_999)
    expect(child.signals).toEqual(['SIGTERM'])
    expect(child.exitCode).toBe(null)
    await vi.advanceTimersByTimeAsync(1)
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
    await ending
    expect(child.signalCode).toBe('SIGKILL')
  } finally {
    child.exit()
    await ending
    vi.useRealTimers()
  }
})

it('kills the created child when a pending Codex start is canceled', async () => {
  const child = new FakeChild()
  child.rpc = true
  child.holdMethod = 'initialize'
  const entered = deferred<void>()
  child.onRequest = (method) => {
    if (method === 'initialize') entered.resolve()
  }
  const h = await fixture(child)
  const controller = new AbortController()
  const starting = h.factory.codex({
    ...h.options,
    credential: { type: 'gateway', ...turn('1', 'alice', 'codex').credential },
    choice: turn('1', 'alice', 'codex').message.choice,
    signal: controller.signal,
  })
  const rejected = expect(starting).rejects.toThrow('The agent process ended.')
  await entered.promise
  const requested = deferred<void>()
  child.onKill = () => requested.resolve()
  vi.useFakeTimers()
  controller.abort()
  try {
    await requested.promise
    await vi.advanceTimersByTimeAsync(0)
    expect(child.exitCode).toBe(null)
  } finally {
    child.exit()
    await rejected
    vi.useRealTimers()
  }
  expect(child.exitCode).toBe(0)
})
