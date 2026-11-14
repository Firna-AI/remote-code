import { object, string } from '../parse'
import type { ProcessPort } from './process'
import { errorText } from './failure'

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class JsonRpcError extends Error {
  readonly data: unknown

  constructor(error: unknown) {
    super(errorText(error) ?? 'The agent refused the request.')
    this.data =
      typeof error === 'object' && error !== null && 'data' in error
        ? error.data
        : undefined
  }
}

export class JsonRpc {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly port: ProcessPort
  private readonly notification: (method: string, params: unknown) => void
  private readonly exited: () => void
  private closed = false

  constructor(
    port: ProcessPort,
    notification: (method: string, params: unknown) => void,
    exited: () => void,
  ) {
    this.port = port
    this.notification = notification
    this.exited = exited
    port.onLine((line) => {
      try {
        const value: unknown = JSON.parse(line)
        this.receive(object(value))
      } catch {
        this.fail()
      }
    })
    port.onExit(() => this.fail())
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.closed)
      return Promise.reject(new Error('The agent process ended.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('The agent request did not finish.'))
        this.fail()
      }, 60_000)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.port.write(JSON.stringify({ id, method, params }))
      } catch {
        this.fail()
      }
    })
  }

  notify(method: string): void {
    this.port.write(JSON.stringify({ method }))
  }

  async close(): Promise<void> {
    this.closed = true
    this.rejectPending()
    await this.port.close()
  }

  private receive(input: Record<string, unknown>): void {
    if (typeof input.method === 'string') {
      if (input.id !== undefined) {
        this.port.write(
          JSON.stringify({
            id: input.id,
            error: {
              code: -32601,
              message: 'The runner does not handle this request.',
            },
          }),
        )
      } else this.notification(string(input.method), input.params)
      return
    }
    if (typeof input.id !== 'number')
      throw new Error('Expected an agent response.')
    const pending = this.pending.get(input.id)
    if (!pending) return
    this.pending.delete(input.id)
    clearTimeout(pending.timer)
    if (input.error !== undefined) pending.reject(new JsonRpcError(input.error))
    else pending.resolve(input.result)
  }

  private rejectPending(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('The agent process ended.'))
    }
    this.pending.clear()
  }

  private fail(): void {
    if (this.closed) return
    void this.close().then(this.exited, this.exited)
  }
}
