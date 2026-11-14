import type { WorkspaceToRunner } from '../../src/shared/generated/WorkspaceToRunner'
import type { WorkspaceEventEnvelope } from './workspace-events'
import type { ChatTransaction } from './store'
import type { NativeChatCallbacks } from '../test-support/native-chat-resolvers'
import { nativeChatStore } from './native-store.test-support'
import { seedRunnerWorkspace } from './runner-seed.test-support'
import { choice, context } from './runner-fixtures.test-support'

export async function createRunnerLimitsFixture(
  overrides: NativeChatCallbacks = {},
) {
  const native = await nativeChatStore()
  const { harness, actor, store } = native
  await seedRunnerWorkspace(harness)
  const options = { callbacks: overrides, idPrefix: 'command', idWidth: 0 }
  await native.configure(options)
  const sent: WorkspaceToRunner[] = []
  const published: WorkspaceEventEnvelope[] = []
  const hooks: WorkspaceEventEnvelope[] = []
  let connection = 0
  let peer = ''
  let streamId = 'stream'
  let closed = 0
  const collect = async () => {
    const batch = await actor.api.peers.take(peer)
    closed += batch.closed
    for (const message of batch.messages) {
      if (message.type === 'event' || message.type === 'history')
        throw new Error('Unexpected browser message.')
      sent.push(message)
    }
    const events = await actor.api.controls.takeEvents()
    published.push(...events)
    hooks.push(...(await actor.api.controls.takeStoredEvents()))
  }
  const connect = async (stream = streamId, restart = false) => {
    streamId = stream
    if (restart) await actor.restart()
    peer = `runner-${++connection}`
    await actor.api.peers.connectRunner(peer, {
      url: 'https://machines.conductive.test/v1/runner',
      headers: { Authorization: 'Bearer runner-limits-token' },
    })
    await actor.api.peers.receiveRunner(peer, {
      type: 'hello',
      protocolVersion: 2,
      workspaceId: 'workspace',
      streamId,
    })
    await collect()
  }
  await connect()
  await store.change(
    'workspace',
    async (transaction) => {
      await transaction.saveSession({
        id: context.sessionId,
        workspaceId: 'workspace',
        title: 'Session',
        choice,
        createdAt: 25,
        closedAt: null,
        activeTurnId: context.turnId,
        activeTurnStartedAt: null,
        retryMessageId: null,
        startedBy: {
          id: 'sender',
          githubLogin: 'sender',
          displayName: null,
          avatarUrl: null,
        },
        sourceSessionId: null,
        loginAvailable: false,
        loginShared: false,
      })
      await transaction.saveTurn({
        id: context.turnId,
        sessionId: context.sessionId,
        senderId: 'sender',
        messageIds: [],
        state: 'running',
        closeAfterStop: false,
      })
    },
    () => undefined,
  )
  const raw = async (value: unknown) => {
    try {
      await actor.api.peers.receiveRunner(peer, value)
    } finally {
      await collect()
    }
  }
  return {
    ...native,
    sent,
    published,
    hooks,
    connect,
    failCursorCommit: async (eventNumber: number) =>
      native.setStorageHooks({
        beforeCommit: async (staged) => {
          if (
            (await staged.read('workspace', (view) =>
              view.cursor(streamId),
            )) === eventNumber
          )
            throw new Error('Injected storage failure')
        },
      }),
    receive: (eventNumber: number, event: unknown, extra = {}) =>
      raw({
        type: 'event',
        streamId,
        eventNumber,
        occurredAt: 25,
        event,
        ...extra,
      }),
    raw,
    history: () => actor.api.controls.history('workspace'),
    read: <T>(work: (view: ChatTransaction) => Promise<T>) =>
      store.read('workspace', work),
    get closed() {
      return closed
    },
    setFailSend: (fail: boolean) =>
      actor.api.peers.rule(
        peer,
        fail ? { error: 'Injected network failure' } : null,
      ),
  }
}
