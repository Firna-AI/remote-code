import { expect, it } from 'vitest'
import type { ChangesResponse } from '../../shared/generated/ChangesResponse'
import type { WorkspaceEventEnvelope } from '../../shared/events'
import { filePaths } from '../../shared/files'
import { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_IDS, FAKE_TIME } from '../../test-support/fixtures/core'
import { toolFixtures } from '../../test-support/fixtures/tools'
import type { FilesSubscribe } from './files-store'
import { versionOf } from './files-store'
import { followPath } from './follow-path'
import { ResourceLoader } from './resource-loader'
import {
  deferred,
  envelopeAfter,
  filesFor,
  startFiles,
  waitUntil,
  slow,
} from '../files-test-kit'

const org = FAKE_IDS.org
const id = FAKE_IDS.workspace

function paths(files: ReturnType<typeof filesFor>): string[] {
  return [...(files.getSnapshot().tree?.entries.keys() ?? [])]
}

it(
  'applies the recorded creation, move, removal, totals, and unpushed commits after the route reads',
  slow,
  async () => {
    const server = new FakeApiServer()
    const files = filesFor(server)
    await startFiles(files)
    const snapshot = files.getSnapshot()
    expect(snapshot.tree?.revision).toBe(2)
    expect(paths(files)).toEqual(
      expect.arrayContaining(['notes.txt', 'docs', 'docs/README.md']),
    )
    expect(paths(files)).not.toContain('README.md')
    expect(paths(files)).not.toContain('.env.example')
    expect(snapshot.changes?.summary).toEqual({
      files: 7,
      added: 161,
      removed: 50,
    })
    expect(snapshot.changes).toMatchObject({ unpushedCommits: 2 })
    expect(
      snapshot.changes?.files.find((file) => file.path === 'docs/README.md'),
    ).toMatchObject({ change: 'renamed', previousPath: 'README.md' })
  },
)

it(
  'skips a repeated event and reads the missed events again after a gap',
  slow,
  async () => {
    const server = new FakeApiServer()
    const after: number[] = []
    let dropped = false
    // An adapter that loses the first live event, as a dropped socket would.
    const subscribe: FilesSubscribe = (afterEventNumber, listener) => {
      after.push(afterEventNumber)
      return server.events.subscribe(afterEventNumber, (message) => {
        if (message.type === 'event' && !dropped) {
          dropped = true
          return
        }
        listener(message)
      })
    }
    const files = filesFor(server, subscribe)
    await startFiles(files)
    const entry = { name: 'a.ts', kind: 'file', change: 'added' } as const
    const first = envelopeAfter(server, {
      type: 'files.changed',
      delta: {
        revision: 3,
        changes: [{ operation: 'upsert', entry: { ...entry, path: 'a.ts' } }],
      },
    })
    server.events.emit(first)
    const second = envelopeAfter(server, {
      type: 'files.changed',
      delta: {
        revision: 4,
        changes: [{ operation: 'upsert', entry: { ...entry, path: 'b.ts' } }],
      },
    })
    server.events.emit(second)
    // The last number again, with other content: the store keeps the first.
    server.events.emit({
      ...second,
      event: {
        type: 'files.changed',
        delta: {
          revision: 5,
          changes: [{ operation: 'remove', path: 'b.ts' }],
        },
      },
    })
    expect(after).toEqual([0, first.eventNumber - 1])
    expect(paths(files)).toEqual(expect.arrayContaining(['a.ts', 'b.ts']))
    expect(files.getSnapshot().tree?.revision).toBe(4)
  },
)

it(
  'keeps the tree of the stream when an older route read answers later',
  slow,
  async () => {
    const server = new FakeApiServer()
    const treeReply = deferred<Response>()
    const fetch = (input: string, init?: RequestInit) =>
      input === filePaths.tree(org, id)
        ? treeReply.promise
        : server.fetch(input, init)
    // The history reaches the store after its route reads started.
    let deliver = () => {}
    const subscribe: FilesSubscribe = (after, listener) =>
      server.events.subscribe(after, (message) => {
        if (message.type === 'history') deliver = () => listener(message)
        else listener(message)
      })
    const files = filesFor(server, subscribe, fetch)
    files.start()
    deliver()
    expect(files.getSnapshot().tree?.revision).toBe(2)
    const shown = files.getSnapshot()
    treeReply.resolve(Response.json(toolFixtures().files))
    await waitUntil(() => expect(files.getSnapshot()).not.toBe(shown))
    expect(files.getSnapshot().tree?.revision).toBe(2)
    expect(paths(files)).toContain('docs/README.md')
    expect(paths(files)).not.toContain('README.md')
  },
)

it(
  'reads the tree route again when an update skips a revision',
  slow,
  async () => {
    const server = new FakeApiServer()
    const files = filesFor(server, (after, listener) =>
      server.events.subscribe(
        Math.max(after, server.events.history().throughEventNumber),
        listener,
      ),
    )
    await startFiles(files)
    expect(files.getSnapshot().tree?.revision).toBe(1)
    server.json('GET', filePaths.tree(org, id), {
      ...toolFixtures().files,
      revision: 2,
    })
    server.events.emit(
      envelopeAfter(server, {
        type: 'files.changed',
        delta: {
          revision: 3,
          changes: [
            {
              operation: 'upsert',
              entry: {
                path: 'c.ts',
                name: 'c.ts',
                kind: 'file',
                change: 'added',
              },
            },
          ],
        },
      }),
    )
    await waitUntil(() => expect(files.getSnapshot().tree?.revision).toBe(3))
    const treeReads = server.requests.filter(
      (request) => new URL(request.url).pathname === filePaths.tree(org, id),
    )
    expect(treeReads).toHaveLength(2)
    expect(paths(files)).toContain('c.ts')
  },
)

it(
  'reads an open diff again when the change list updates with equal counts',
  slow,
  async () => {
    const server = new FakeApiServer()
    const files = filesFor(server)
    await startFiles(files)
    const path = 'src/app/checkout/AddressForm.tsx'
    const diff = toolFixtures().diff
    server.json('GET', filePaths.diff(org, id, path), {
      ...diff,
      patch: '@@ -1 +1 @@\n-a\n+b\n',
    })
    const loader = new ResourceLoader((key, signal) =>
      files.client.readDiff(key, signal),
    )
    const stop = followPath(files, loader, path)
    await waitUntil(() => expect(loader.getSnapshot()?.status).toBe('ready'))
    const before = versionOf(files.getSnapshot(), path)
    server.json('GET', filePaths.diff(org, id, path), {
      ...diff,
      patch: '@@ -1 +1 @@\n-a\n+c\n',
    })
    const changes: ChangesResponse | null = files.getSnapshot().changes
    if (!changes) throw new Error('The changes did not load.')
    server.events.emit(
      envelopeAfter(server, { type: 'changes.updated', changes }),
    )
    await waitUntil(() => {
      const state = loader.getSnapshot()
      expect(state?.status === 'ready' && state.value.patch).toBe(
        '@@ -1 +1 @@\n-a\n+c\n',
      )
    })
    expect(versionOf(files.getSnapshot(), path)).not.toBe(before)
    stop()
  },
)

it(
  'applies history pages across left-out numbers, and holds live events until the final page',
  slow,
  async () => {
    const server = new FakeApiServer()
    const after: number[] = []
    let send: (message: unknown) => void = () => {}
    const files = filesFor(server, (afterEventNumber, listener) => {
      after.push(afterEventNumber)
      send = listener
      return () => {}
    })
    await startFiles(files)
    const changes = files.getSnapshot().changes
    if (!changes) throw new Error('The changes did not load.')
    const listed = (count: number) => ({
      ...changes,
      summary: { ...changes.summary, files: count },
    })
    const at = (
      eventNumber: number,
      event: WorkspaceEventEnvelope['event'],
    ) => ({
      workspaceId: id,
      eventNumber,
      occurredAt: FAKE_TIME,
      event,
    })
    const page = (
      events: readonly WorkspaceEventEnvelope[],
      through: number,
      next?: number,
    ) => ({
      type: 'history',
      history: {
        events,
        throughEventNumber: through,
        ...(next === undefined
          ? {}
          : { hasMore: true, nextAfterEventNumber: next }),
      },
    })
    send(page([at(4, { type: 'changes.updated', changes: listed(1) })], 10, 5))
    send({
      type: 'event',
      envelope: at(11, { type: 'changes.updated', changes: listed(9) }),
    })
    expect(files.getSnapshot().changes?.summary.files).toBe(1)
    const added = { name: 'paged.ts', kind: 'file', change: 'added' } as const
    send(
      page(
        [
          at(9, {
            type: 'files.changed',
            delta: {
              revision: 2,
              changes: [
                { operation: 'upsert', entry: { ...added, path: 'paged.ts' } },
              ],
            },
          }),
        ],
        10,
      ),
    )
    expect(paths(files)).toContain('paged.ts')
    expect(files.getSnapshot().changes?.summary.files).toBe(9)
    expect(after).toEqual([0])
    files.stop()
  },
)
