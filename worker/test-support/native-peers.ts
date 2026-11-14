import type { WorkspaceToRunner } from '../../src/shared/generated/WorkspaceToRunner'
import type { WorkspaceSocketMessage } from '../../src/shared/events'
import type { WorkspaceChat } from '../chat/backend'
import type { BrowserPeer, RunnerPeer } from '../chat/types'

interface NativeRequest {
  url: string
  headers?: Record<string, string>
}

export interface NativeSendRule {
  type?: string
  messageId?: string
  drop?: boolean
  error?: string
}

interface NativePeerMessages {
  messages: (WorkspaceToRunner | WorkspaceSocketMessage)[]
  attempted: (WorkspaceToRunner | WorkspaceSocketMessage)[]
  closed: number
  messageOrder: number[]
  attemptedOrder: number[]
}

export interface NativePeers {
  connectRunner(id: string, request: NativeRequest): Promise<void>
  receiveRunner(id: string, value: unknown): Promise<void>
  receiveMany(id: string, values: readonly unknown[]): Promise<void>
  openBrowser(id: string, request: NativeRequest): Promise<void>
  close(id: string): Promise<void>
  rule(id: string, rule: NativeSendRule | null): Promise<void>
  take(id: string): Promise<NativePeerMessages>
}

export function nativePeers(chat: WorkspaceChat): NativePeers {
  let sequence = 0
  const peers = new Map<
    string,
    {
      peer: RunnerPeer & BrowserPeer
      close(): void
      rule: NativeSendRule | null
      messages: NativePeerMessages
    }
  >()
  const create = (id: string) => {
    const messages: NativePeerMessages = {
      messages: [],
      attempted: [],
      closed: 0,
      messageOrder: [],
      attemptedOrder: [],
    }
    const state = {
      messages,
      rule: null as NativeSendRule | null,
    }
    const peer: RunnerPeer & BrowserPeer = {
      send: (message) => {
        const order = ++sequence
        state.messages.attempted.push(structuredClone(message))
        state.messages.attemptedOrder.push(order)
        const rule = state.rule
        if (
          rule &&
          (!rule.type || rule.type === message.type) &&
          (!rule.messageId ||
            ('message' in message && message.message.id === rule.messageId))
        ) {
          if (rule.error) throw new Error(rule.error)
          if (rule.drop) return
        }
        state.messages.messages.push(structuredClone(message))
        state.messages.messageOrder.push(order)
      },
      close: () => {
        state.messages.closed++
      },
    }
    const value = Object.assign(state, {
      peer,
      close: () => chat.disconnectRunner(peer),
    })
    peers.set(id, value)
    return value
  }
  const find = (id: string) => {
    const value = peers.get(id)
    if (!value) throw new Error(`Unknown native peer: ${id}`)
    return value
  }
  return {
    connectRunner: async (id, request) => {
      const value = create(id)
      await chat.connectRunner(
        new Request(request.url, { headers: request.headers }),
        value.peer,
      )
    },
    receiveRunner: async (id, value) =>
      chat.receiveRunner(find(id).peer, value),
    receiveMany: async (id, values) => {
      for (const value of values) await chat.receiveRunner(find(id).peer, value)
    },
    openBrowser: async (id, request) => {
      const value = create(id)
      value.close = await chat.openBrowser(
        new Request(request.url, { headers: request.headers }),
        value.peer,
      )
    },
    close: async (id) => {
      find(id).close()
    },
    rule: async (id, rule) => {
      find(id).rule = rule
    },
    take: async (id) => {
      const value = find(id)
      return {
        messages: value.messages.messages.splice(0),
        attempted: value.messages.attempted.splice(0),
        closed: value.messages.closed,
        messageOrder: value.messages.messageOrder.splice(0),
        attemptedOrder: value.messages.attemptedOrder.splice(0),
      }
    },
  }
}
