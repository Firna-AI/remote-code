import { spawn } from 'node:child_process'
import { Writable } from 'node:stream'
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import type { RunnerLogin } from '../generated/RunnerLogin'
import { FakeChild } from '../../test-support/child'
import { FakeClaudeQuery } from '../../test-support/claude-query'
import { mockComputerServer } from '../../test-support/computer-mcp'
import { turn } from '../../test-support/input'
import { fakeToolContext } from '../../test-support/input'
import { deferred } from '../../test-support/runtime'
import { createClaudeFactory, type ClaudeQueryFactory } from './claude'
import * as environment from './environment'

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}))

beforeEach(() => {
  mockComputerServer()
  vi.spyOn(environment, 'prepareProviderHome').mockResolvedValue()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function fixture(kind: RunnerLogin['kind'] = 'token') {
  const child = new FakeChild()
  child.exitOnSignal = 'SIGTERM'
  const bytes: string[] = []
  const pipe = new Writable({
    write: (chunk: Buffer, _encoding, done) => {
      bytes.push(chunk.toString('utf8'))
      done()
    },
    final: (done) => done(),
  })
  child.stdio = [child.stdin, child.stdout, child.stderr, pipe, null]
  const closed = deferred<void>()
  pipe.once('close', () => closed.resolve())
  vi.mocked(spawn).mockReturnValue(child)
  const sdk = new FakeClaudeQuery()
  const options = {
    cwd: '/repo',
    home: '/private-agent-home',
    sessionId: 'measurement-session',
    endpoint: 'https://api.anthropic.com',
    credential: {
      type: 'native' as const,
      login: { agent: 'claude' as const, kind, secret: 'private-test-login' },
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
    const spawnProvider = parameters.options?.spawnClaudeCodeProcess
    if (!spawnProvider) throw new Error('The test needs a custom spawn.')
    spawnProvider({
      command: '/pinned/sdk/claude',
      args: ['--input-format', 'stream-json'],
      cwd: options.cwd,
      env: parameters.options?.env ?? {},
      signal: new AbortController().signal,
    })
    return sdk.open(parameters)
  }
  return { child, pipe, bytes, sdk, start, options, closed }
}

it.each([
  ['token', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR'],
  ['api-key', 'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR'],
] as const)(
  'gives the native Claude %s login only through its private descriptor',
  async (kind, descriptor) => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'inherited-api-key')
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'inherited-token')
    vi.stubEnv('OPENAI_API_KEY', 'inherited-openai-key')
    vi.stubEnv('CLAUDE_CODE_REMOTE', '1')
    vi.stubEnv('CLAUDE_CODE_PROMPT_CACHE_TTL', '1h')
    vi.stubEnv('CONDUCTIVE_MEASURE_LOGIN', 'private-test-login')
    const h = fixture(kind)
    const provider = await createClaudeFactory(
      undefined,
      () => '/fake/claude',
    )(h.options)
    onTestFinished(() => provider.close())
    const request = vi.mocked(spawn).mock.calls[0]
    expect(request[2]?.env?.[descriptor] === '3').toBe(true)
    expect(request[2]?.stdio).toEqual(['pipe', 'pipe', 'ignore', 'pipe'])
    expect(
      /private-test-login|inherited-api-key|inherited-token|inherited-openai-key/.test(
        JSON.stringify(request),
      ),
    ).toBe(false)
    expect(Object.hasOwn(request[2]?.env ?? {}, 'CLAUDE_CODE_REMOTE')).toBe(
      false,
    )
    expect(request[2]?.env?.CLAUDE_CODE_PROMPT_CACHE_TTL).toBeUndefined()
    expect(h.bytes).toEqual(['private-test-login\n'])
    await h.closed.promise
    expect(h.child.signals).toEqual([])
    expect(h.pipe.destroyed).toBe(true)
    await provider.close()
    expect(h.pipe.destroyed).toBe(true)
    expect(h.child.signals).toEqual(['SIGTERM'])
  },
)

it('closes the Claude child when its private login pipe fails', async () => {
  const h = fixture()
  vi.spyOn(h.pipe, '_write').mockImplementation((_chunk, _encoding, done) => {
    done(new Error('private pipe failure'))
  })
  const killed = deferred<void>()
  h.child.onKill = () => killed.resolve()
  const provider = await createClaudeFactory(
    h.start,
    () => '/fake/claude',
  )(h.options)
  onTestFinished(() => provider.close())
  await killed.promise
  expect(h.child.signals).toEqual(['SIGTERM'])
  expect(h.pipe.destroyed).toBe(true)
})

it('closes the Claude login pipe and child when SDK setup throws after spawn', async () => {
  const h = fixture()
  const start: ClaudeQueryFactory = (parameters) => {
    h.start(parameters)
    throw new Error('SDK setup failed')
  }
  await expect(
    createClaudeFactory(start, () => '/fake/claude')(h.options),
  ).rejects.toThrow('SDK setup failed')
  expect(h.pipe.destroyed).toBe(true)
  expect(h.child.signals).toEqual(['SIGTERM'])
})

it('closes a pending Claude login pipe when the child exits', async () => {
  const h = fixture()
  vi.spyOn(h.pipe, '_final').mockImplementation(() => {})
  const provider = await createClaudeFactory(
    h.start,
    () => '/fake/claude',
  )(h.options)
  onTestFinished(() => provider.close())
  expect(h.pipe.destroyed).toBe(false)
  h.child.exit()
  await provider.close()
  expect(h.pipe.destroyed).toBe(true)
})
