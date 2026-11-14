import type { RunnerToWorkspace } from '../../src/shared/generated/RunnerToWorkspace'
import type { WorkspaceToRunner } from '../../src/shared/generated/WorkspaceToRunner'
import type { WorkspaceSocketMessage } from '../../src/shared/events'
import type { RunnerConnectionRequest } from '../../src/shared/runner-transport'
import { FakeRunner } from '../test-support/fake-runner'
import { FakeRunnerConnection } from '../test-support/runner-connection'
import type { NativeActor } from '../test-support/native-runtime'
import type { NativeSendRule } from '../test-support/native-peers'

export function nativeChatTransport(actor: NativeActor) {
  let sequence = 0
  let workGeneration = 0
  let sendRule: NativeSendRule | null = null
  let observer: ((message: WorkspaceToRunner) => void) | undefined
  const pending = new Set<Promise<unknown>>()
  const inputWork = new Set<Promise<unknown>>()
  const closing = new Set<Promise<unknown>>()
  const errors: unknown[] = []
  const incoming = new Map<string, RunnerToWorkspace[]>()
  const runners = new Map<string, FakeRunnerConnection>()
  const browsers = new Map<
    string,
    {
      messages: WorkspaceSocketMessage[]
      onSend?: (message: WorkspaceSocketMessage) => void
      onClose?: () => void
      closed: number
    }
  >()
  const transport = {
    dropIncoming: (value: RunnerToWorkspace) => {
      void value
      return false
    },
    closedConnections: 0,
  }
  const track = (work: Promise<unknown>, input = false) => {
    workGeneration++
    pending.add(work)
    if (input) inputWork.add(work)
    void work.then(
      () => {
        pending.delete(work)
        inputWork.delete(work)
        closing.delete(work)
      },
      (error: unknown) => {
        pending.delete(work)
        inputWork.delete(work)
        closing.delete(work)
        errors.push(error)
      },
    )
  }
  const pump = async () => {
    const deliveries: { order: number; send(): void }[] = []
    const closes: (() => void)[] = []
    for (const [id, connection] of runners) {
      const batch = await actor.api.peers.take(id)
      batch.attempted.forEach((message, index) => {
        if (message.type !== 'event' && message.type !== 'history')
          deliveries.push({
            order: batch.attemptedOrder[index],
            send: () => observer?.(message),
          })
      })
      batch.messages.forEach((message, index) => {
        if (message.type === 'event' || message.type === 'history')
          throw new Error('Unexpected browser message.')
        deliveries.push({
          order: batch.messageOrder[index],
          send: () => connection.reply(message),
        })
      })
      if (batch.closed) closes.push(() => connection.close())
    }
    for (const [id, browser] of browsers) {
      const batch = await actor.api.peers.take(id)
      while (browser.closed < batch.closed) {
        browser.closed++
        browser.onClose?.()
      }
      batch.messages.forEach((message, index) => {
        if (message.type !== 'event' && message.type !== 'history')
          throw new Error('Unexpected runner message.')
        deliveries.push({
          order: batch.messageOrder[index],
          send: () => {
            browser.messages.push(message)
            browser.onSend?.(message)
          },
        })
      })
    }
    for (const delivery of deliveries.sort(
      (left, right) => left.order - right.order,
    ))
      delivery.send()
    for (const close of closes) close()
    return deliveries.length
  }
  const receive = (id: string, value: RunnerToWorkspace) => {
    if (transport.dropIncoming(value)) return
    const queued = incoming.get(id)
    if (queued) {
      queued.push(value)
      return
    }
    incoming.set(id, [value])
    queueMicrotask(() => {
      const batch = incoming.get(id)
      incoming.delete(id)
      if (batch) track(actor.api.peers.receiveMany(id, batch), true)
    })
  }
  const flushInput = async () => {
    await Promise.resolve()
    await Promise.allSettled([...inputWork])
  }
  const drain = async () => {
    let observed: number
    do {
      observed = workGeneration
      // Admit each batched input before taking the pending-work snapshot.
      await flushInput()
      await Promise.allSettled([...pending])
      await actor.api.controls.drain()
    } while (
      (await pump()) > 0 ||
      pending.size ||
      incoming.size ||
      observed !== workGeneration
    )
    if (errors.length) throw errors.shift()
  }
  return {
    transport,
    flushInput,
    disconnect: async (runner: FakeRunner) => {
      runner.disconnect()
      await Promise.allSettled([...closing])
    },
    pump,
    drain,
    connect: async (
      runner: FakeRunner,
      parameters: RunnerConnectionRequest,
    ) => {
      await runner.connect(async (input) => {
        const id = `runner-${++sequence}`
        const connection = new FakeRunnerConnection((value) => {
          receive(id, value)
        })
        connection.onClose(() => {
          if (!runners.has(id)) return
          transport.closedConnections++
          const work = actor.api.peers.close(id)
          closing.add(work)
          track(work)
        })
        runners.set(id, connection)
        await actor.api.peers.connectRunner(id, {
          url: input.url,
          headers: { Authorization: `Bearer ${input.workspaceToken}` },
        })
        await actor.api.peers.rule(id, sendRule)
        return connection
      }, parameters)
      await drain()
      return runner
    },
    tab: async (
      request: Request,
      onSend?: (message: WorkspaceSocketMessage) => void,
      onClose?: () => void,
    ) => {
      const id = `browser-${++sequence}`
      const state = {
        messages: [] as WorkspaceSocketMessage[],
        closed: 0,
        onSend,
        onClose,
      }
      browsers.set(id, state)
      try {
        await actor.api.peers.openBrowser(id, {
          url: request.url,
          headers: Object.fromEntries(request.headers),
        })
      } finally {
        await pump()
      }
      return {
        messages: state.messages,
        close: async () => {
          if (!browsers.has(id)) return
          await actor.api.peers.close(id)
          browsers.delete(id)
        },
        get closed() {
          return state.closed
        },
      }
    },
    setSendRule: async (rule: NativeSendRule | null) => {
      sendRule = rule
      observer = undefined
      await Promise.all(
        [...runners.keys()].map((id) => actor.api.peers.rule(id, rule)),
      )
    },
    observeOutgoing: (work?: (message: WorkspaceToRunner) => void) => {
      observer = work
    },
    reset: () => {
      runners.clear()
      browsers.clear()
      pending.clear()
      inputWork.clear()
      closing.clear()
      incoming.clear()
      errors.splice(0)
    },
  }
}
