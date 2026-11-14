import {
  afterAll,
  beforeAll,
  beforeEach,
  expect,
  it,
  onTestFinished,
} from 'vitest'
import type { RunnerFileCommand } from '../../src/shared/generated/RunnerFileCommand'
import { filePaths } from '../../src/shared/files'
import { createHarness, type TestHarness } from '../test-support/harness'
import { setupFilesHttp } from './test-support/http'
import { connectWorkspaceFiles } from './test-support/runner'
import {
  createFilesStorage,
  type FilesStorageHarness,
} from './test-support/storage'

let harness: TestHarness
let runtime: FilesStorageHarness
beforeAll(async () => {
  harness = await createHarness()
  runtime = await createFilesStorage()
})
beforeEach(async () => {
  await harness.reset()
})
afterAll(async () => {
  await runtime.dispose()
  await harness.dispose()
})

it('sends decoded tab, newline, and backslash names through the file route', async () => {
  const { org, workspaceId, request, files } = await setupFilesHttp(
    harness,
    runtime,
  )
  const connected = await connectWorkspaceFiles(files)
  onTestFinished(() => connected.runner.disconnect())
  const paths = ['tab\tname.txt', 'line\nname.txt', 'back\\slash.txt']
  for (const [index, path] of paths.entries()) {
    const response = request(filePaths.content(org.id, workspaceId, path))
    const requestId = `request-${index + 1}`
    expect(
      await Promise.race([
        connected.nextCommand(),
        response.then((reply) => reply.status),
      ]),
      JSON.stringify(path),
    ).toEqual({ type: 'file.read', requestId, path, maxBytes: 1024 })
    connected.runner.reply({
      type: 'file.read.result',
      requestId,
      result: {
        ok: true,
        file: {
          path,
          mediaType: 'text/plain',
          sizeBytes: 6,
          encoding: 'utf-8',
          content: '\uFEFFabc',
        },
      },
    })
    const reply = await response
    expect(reply.status).toBe(200)
    expect(await reply.json()).toEqual({
      path,
      mediaType: 'text/plain',
      sizeBytes: 6,
      encoding: 'utf-8',
      content: '\uFEFFabc',
    })
  }
  expect(harness.boat.requests).toHaveLength(0)
})

it('rejects NUL and empty, dot, and dotdot query path segments before runner access', async () => {
  const { org, workspaceId, request, files } = await setupFilesHttp(
    harness,
    runtime,
  )
  const commands: RunnerFileCommand[] = []
  const connectionId = 'invalid-paths'
  await files.connect(connectionId, (command) => {
    commands.push(command)
    files.runner.receive(connectionId, {
      type: 'file.read.result',
      requestId: command.requestId,
      result: {
        ok: false,
        error: {
          code: 'file_unavailable',
          message: 'The fake file is unavailable.',
        },
      },
    })
  })
  onTestFinished(() => files.disconnect(connectionId))
  for (const path of [
    '',
    'nul\0.txt',
    '/file.txt',
    'dir//file.txt',
    './file.txt',
    'dir/./file.txt',
    'dir/../file.txt',
    'file.txt/',
    '.',
    '..',
  ]) {
    const response = await request(filePaths.content(org.id, workspaceId, path))
    expect(response.status, JSON.stringify(path)).toBe(400)
    expect(await response.json()).toEqual({
      error: {
        code: 'invalid_input',
        message: 'Choose a file in this repository.',
      },
    })
  }
  expect(commands).toHaveLength(0)
  expect(harness.boat.requests).toHaveLength(0)
})
