import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'

import { FakeChild } from '../../test-support/child'
import { FakeClaudeQuery } from '../../test-support/claude-query'
import { mockComputerServer } from '../../test-support/computer-mcp'
import { turn } from '../../test-support/input'
import { fakeToolContext } from '../../test-support/input'
import { deferred } from '../../test-support/runtime'
import { createClaudeFactory, type ClaudeQueryFactory } from './claude'
import { writeClaudeProfile, type ClaudeProfile } from './claude-profile'
import { ProviderLifetime } from './lifetime'

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}))

beforeEach(mockComputerServer)
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'conductive-gateway-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const child = new FakeChild()
  child.exitOnSignal = 'SIGTERM'
  vi.mocked(spawn).mockReturnValue(child)
  const sdk = new FakeClaudeQuery()
  const options = {
    cwd: '/repo',
    home,
    sessionId: 'session/alice',
    endpoint: 'https://machines.conductive.test/v1/model/claude',
    credential: {
      type: 'gateway' as const,
      agent: 'claude' as const,
      kind: 'api-key' as const,
      token: 'sk-ant-api-turn-token',
    },
    commitAuthor: null,
    choice: turn().message.choice,
    conversationId: null,
    instructions: '',
    tools: fakeToolContext,
    event: () => {},
    warn: () => {},
  }
  const start: ClaudeQueryFactory = (parameters) => {
    const custom = parameters.options?.spawnClaudeCodeProcess
    if (!custom) throw new Error('The test requires the owned process.')
    custom({
      command: '/fake/claude',
      args: [],
      cwd: options.cwd,
      env: parameters.options?.env ?? {},
      signal: new AbortController().signal,
    })
    return sdk.open(parameters)
  }
  const credential = () => {
    const env = sdk.parameters?.options?.env
    return join(
      env?.ANTHROPIC_CONFIG_DIR ?? home,
      'credentials',
      `${env?.ANTHROPIC_PROFILE ?? 'missing'}.json`,
    )
  }
  return { child, sdk, options, start, credential }
}

it('starts Claude with profile selectors and no gateway settings or credential descriptor', async () => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'project-api-key')
  vi.stubEnv('ANTHROPIC_BASE_URL', 'https://project.example')
  vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'project-token')
  const h = await fixture()
  const provider = await createClaudeFactory(
    h.start,
    () => '/fake/claude',
  )(h.options)
  onTestFinished(() => provider.close())
  const options = h.sdk.parameters?.options
  expect(options?.env?.ANTHROPIC_CONFIG_DIR).toBe(
    join(h.options.home, '.conductive', 'anthropic'),
  )
  expect(options?.env?.ANTHROPIC_PROFILE).toMatch(/^[A-Za-z0-9_.-]+$/)
  expect(options?.settingSources).toEqual(['project'])
  expect(options?.settings).toEqual({ fastMode: false })
  expect(
    Object.keys(options?.env ?? {}).filter((key) =>
      /^(ANTHROPIC_|CLAUDE_CODE_.*FILE_DESCRIPTOR)/.test(key),
    ),
  ).toEqual(['ANTHROPIC_CONFIG_DIR', 'ANTHROPIC_PROFILE'])
  expect(
    /sk-ant-api-turn-token|\/v1\/model\/claude|project-api-key|project-token|project\.example/.test(
      JSON.stringify(vi.mocked(spawn).mock.calls),
    ),
  ).toBe(false)
  expect(vi.mocked(spawn).mock.calls[0][2]?.stdio).toEqual([
    'pipe',
    'pipe',
    'ignore',
  ])
  expect(await readFile(h.credential(), 'utf8')).toBe(
    '{"access_token":"sk-ant-api-turn-token"}',
  )
  await provider.close()
  expect(await readFile(h.credential(), 'utf8').catch(() => null)).toBe(null)
  expect(h.child.signals).toEqual(['SIGTERM'])
})

it.each([
  { name: 'subscription', credential: { kind: 'token' } },
  {
    name: 'own endpoint',
    credential: { kind: 'api-key', promptCacheTtl: '1h' },
  },
] as const)(
  'requests a one-hour Claude cache for gateway $name turns',
  async ({ credential }) => {
    vi.stubEnv('CLAUDE_CODE_PROMPT_CACHE_TTL', '5m')
    const h = await fixture()
    const provider = await createClaudeFactory(
      h.start,
      () => '/fake/claude',
    )({
      ...h.options,
      credential: { ...h.options.credential, ...credential },
    })
    onTestFinished(() => provider.close())
    expect(h.sdk.parameters?.options?.env?.CLAUDE_CODE_PROMPT_CACHE_TTL).toBe(
      '1h',
    )
    expect(
      vi.mocked(spawn).mock.calls[0][2]?.env?.CLAUDE_CODE_PROMPT_CACHE_TTL,
    ).toBe('1h')
  },
)

it('keeps the Claude cache default for gateway API-key turns', async () => {
  vi.stubEnv('CLAUDE_CODE_PROMPT_CACHE_TTL', '1h')
  const h = await fixture()
  const provider = await createClaudeFactory(
    h.start,
    () => '/fake/claude',
  )(h.options)
  onTestFinished(() => provider.close())
  expect(
    h.sdk.parameters?.options?.env?.CLAUDE_CODE_PROMPT_CACHE_TTL,
  ).toBeUndefined()
  expect(
    vi.mocked(spawn).mock.calls[0][2]?.env?.CLAUDE_CODE_PROMPT_CACHE_TTL,
  ).toBeUndefined()
})

it('removes a Claude profile after SDK setup fails and after an active start is aborted', async () => {
  const failed = await fixture()
  const start: ClaudeQueryFactory = (parameters) => {
    failed.start(parameters)
    throw new Error('SDK setup failed')
  }
  await expect(
    createClaudeFactory(start, () => '/fake/claude')(failed.options),
  ).rejects.toThrow('SDK setup failed')
  expect(await readFile(failed.credential(), 'utf8').catch(() => null)).toBe(
    null,
  )
  expect(failed.child.signals).toEqual(['SIGTERM'])
  const h = await fixture()
  const controller = new AbortController()
  const provider = await createClaudeFactory(
    h.start,
    () => '/fake/claude',
  )({ ...h.options, signal: controller.signal })
  onTestFinished(() => provider.close())
  expect(await readFile(h.credential(), 'utf8').catch(() => null)).toBe(
    '{"access_token":"sk-ant-api-turn-token"}',
  )
  controller.abort()
  await provider.close()
  expect(await readFile(h.credential(), 'utf8').catch(() => null)).toBe(null)
  expect(h.child.signals).toEqual(['SIGTERM'])
})

it('waits for a canceled profile preparation and removes its token before teardown ends', async () => {
  const h = await fixture()
  const entered = deferred<ClaudeProfile>()
  const release = deferred<void>()
  const controller = new AbortController()
  const lifetime = new ProviderLifetime()
  const factory = createClaudeFactory(
    h.start,
    () => '/fake/claude',
    async (...args) => {
      const profile = await writeClaudeProfile(...args)
      entered.resolve(profile)
      await release.promise
      return profile
    },
  )
  const opening = factory({ ...h.options, lifetime, signal: controller.signal })
  const profile = await entered.promise
  const credential = join(
    profile.directory,
    'credentials',
    `${profile.name}.json`,
  )
  controller.abort(new Error('start canceled'))
  let ended = false
  const closing = lifetime.close().then(() => {
    ended = true
  })
  onTestFinished(async () => {
    release.resolve()
    await Promise.allSettled([opening, closing])
  })
  expect(await readFile(credential, 'utf8')).toBe(
    '{"access_token":"sk-ant-api-turn-token"}',
  )
  expect(ended).toBe(false)
  release.resolve()
  await expect(opening).rejects.toThrow('start canceled')
  await closing
  expect(ended).toBe(true)
  expect(await readFile(credential, 'utf8').catch(() => null)).toBe(null)
  const next = await writeClaudeProfile(
    h.options.home,
    h.options.sessionId,
    h.options.endpoint,
    'next-turn-token',
  )
  expect(next.name).toBe(profile.name)
  await lifetime.close()
  expect(await readFile(credential, 'utf8').catch(() => null)).toBe(
    '{"access_token":"next-turn-token"}',
  )
  await next.remove()
})
