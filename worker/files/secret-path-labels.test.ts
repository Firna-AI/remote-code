import { afterAll, beforeAll, expect, it } from 'vitest'
import type { RunnerFileCommand } from '../../src/shared/generated/RunnerFileCommand'
import { filePaths } from '../../src/shared/files'
import { chatFilesStorage } from '../chat/files-storage'
import { WORKSPACE_ID } from '../chat/harness.test-support'
import { outputFixture } from '../chat/runner-output.test-support'
import {
  createHarness,
  TEST_ORIGIN,
  TEST_TIME,
  type TestHarness,
} from '../test-support/harness'
import { createFilesHandler } from './handlers'
import { WorkspaceFiles } from './workspace'

let harness: TestHarness
beforeAll(async () => {
  harness = await createHarness()
})
afterAll(async () => {
  await harness.dispose()
})

it('joins distinct real paths and labels runner reads, diffs, and provider fallback from the start capture', async () => {
  const f = await outputFixture(harness, { A: 'a', ONE: '1', TWO: '2' })
  const paths = ['test1.ts', 'test2.ts']
  await f.emit({
    type: 'files.snapshot',
    tree: {
      revision: 1,
      partNumber: 1,
      partCount: 1,
      entries: paths.map((path) => ({
        path,
        displayPath: '',
        name: path,
        kind: 'file',
        change: null,
      })),
    },
  })
  await f.emit({
    type: 'changes.updated',
    changes: {
      revision: 1,
      partNumber: 1,
      partCount: 1,
      baseBranch: 'main',
      displayBaseBranch: '',
      files: [
        {
          path: 'test2.ts',
          displayPath: '',
          previousPath: 'test1.ts',
          previousDisplayPath: '',
          change: 'renamed',
          added: 1,
          removed: 0,
          uncommitted: true,
        },
      ],
      summary: { files: 1, added: 1, removed: 0 },
    },
  })
  const files = new WorkspaceFiles(
    chatFilesStorage(f.storage),
    () => 'read-request',
  )
  expect((await files.tree())?.entries).toEqual(
    paths.map((path) => ({
      path,
      displayPath: 'test[redacted].ts',
      name: 'test[redacted].ts',
      kind: 'file',
      change: null,
    })),
  )
  expect(await files.changes()).toEqual({
    baseBranch: 'main',
    displayBaseBranch: 'm[redacted]in',
    files: [
      {
        path: 'test2.ts',
        displayPath: 'test[redacted].ts',
        previousPath: 'test1.ts',
        previousDisplayPath: 'test[redacted].ts',
        change: 'renamed',
        added: 1,
        removed: 0,
        uncommitted: true,
      },
    ],
    summary: { files: 1, added: 1, removed: 0 },
  })
  const commands: RunnerFileCommand[] = []
  files.runner.attach('files', (command) => {
    commands.push(command)
    files.runner.receive(
      'files',
      command.type === 'file.read'
        ? {
            type: 'file.read.result',
            requestId: command.requestId,
            result: {
              ok: true,
              file: {
                path: command.path,
                displayPath: '',
                mediaType: 'text/plain',
                sizeBytes: 3,
                encoding: 'utf-8',
                content: 'hi\n',
              },
            },
          }
        : {
            type: 'file.diff.result',
            requestId: command.requestId,
            result: {
              ok: true,
              diff: {
                path: command.path,
                displayPath: '',
                baseBranch: command.defaultBranch,
                displayBaseBranch: '',
                oldContent: '',
                newContent: 'hi\n',
                patch: 'patch',
                binary: false,
              },
            },
          },
    )
  })
  const handler = createFilesHandler({
    maxFileBytes: 100,
    workspaceFiles: () => files,
    repositoryRoot: () => '/home/user/repo',
    fetch: harness.boat.fetch,
    now: () => TEST_TIME,
  })
  const request = (path: string) =>
    handler(
      new Request(`${TEST_ORIGIN}${path}`, {
        headers: { Cookie: f.ownerCookie },
      }),
      f.env,
    )
  const read = await request(
    filePaths.content(f.org.id, WORKSPACE_ID, 'test1.ts'),
  )
  expect(read.status).toBe(200)
  expect(await read.json()).toMatchObject({
    path: 'test1.ts',
    displayPath: 'test[redacted].ts',
    content: 'hi\n',
  })
  const diff = await request(filePaths.diff(f.org.id, WORKSPACE_ID, 'test2.ts'))
  expect(diff.status).toBe(200)
  expect(await diff.json()).toMatchObject({
    path: 'test2.ts',
    displayPath: 'test[redacted].ts',
    baseBranch: 'main',
    displayBaseBranch: 'm[redacted]in',
  })
  expect(commands).toEqual([
    {
      type: 'file.read',
      requestId: 'read-request',
      path: 'test1.ts',
      maxBytes: 100,
    },
    {
      type: 'file.diff',
      requestId: 'read-request',
      path: 'test2.ts',
      defaultBranch: 'main',
    },
  ])
  files.runner.detach('files')
  await f.env.DB.prepare('UPDATE workspaces SET sandbox_id = ? WHERE id = ?')
    .bind('bx_one', WORKSPACE_ID)
    .run()
  harness.boat.responseOverride = Response.json({
    ok: true,
    type: 'file.read',
    success: true,
    path: '/home/user/repo/package.json',
    encoding: 'base64',
    size: 3,
    content: 'aGkK',
  })
  const fallback = await request(
    filePaths.content(f.org.id, WORKSPACE_ID, 'package.json'),
  )
  expect(fallback.status).toBe(200)
  expect(await fallback.json()).toMatchObject({
    path: 'package.json',
    displayPath: 'p[redacted]ck[redacted]ge.json',
    content: 'hi\n',
  })
  expect(
    new URL(harness.boat.requests.at(-1)?.url ?? TEST_ORIGIN).searchParams.get(
      'path',
    ),
  ).toBe('/home/user/repo/package.json')
  const download = await request(
    filePaths.download(f.org.id, WORKSPACE_ID, 'package.json'),
  )
  expect(download.status).toBe(200)
  expect(download.headers.get('Content-Disposition')).toBe(
    "attachment; filename*=UTF-8''package.json",
  )
  expect(await download.text()).toBe('hi\n')
})
