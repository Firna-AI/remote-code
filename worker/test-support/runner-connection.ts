import type { RunnerToWorkspace } from '../../src/shared/generated/RunnerToWorkspace'
import type { WorkspaceToRunner } from '../../src/shared/generated/WorkspaceToRunner'
import type { RunnerConnection } from '../../src/shared/runner-transport'

/** An in-memory socket. Tests close it explicitly, without sleeps or real ports. */
export class FakeRunnerConnection<
  Message extends WorkspaceToRunner = WorkspaceToRunner,
> implements RunnerConnection<Message> {
  private closed = false
  private readonly messages = new Set<(message: Message) => void>()
  private readonly closes = new Set<() => void>()
  private readonly queued: Message[] = []
  private readonly receive: (message: RunnerToWorkspace) => void

  constructor(receive: (message: RunnerToWorkspace) => void) {
    this.receive = receive
  }

  send(message: RunnerToWorkspace): void {
    if (this.closed) throw new Error('The runner connection is closed.')
    this.receive(structuredClone(message))
  }

  reply(message: Message): void {
    if (this.closed) return
    if (this.messages.size === 0) this.queued.push(structuredClone(message))
    for (const listener of this.messages) listener(structuredClone(message))
  }

  onMessage(listener: (message: Message) => void): () => void {
    this.messages.add(listener)
    for (const message of this.queued.splice(0)) listener(message)
    return () => this.messages.delete(listener)
  }

  onClose(listener: () => void): () => void {
    this.closes.add(listener)
    return () => this.closes.delete(listener)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const listener of this.closes) listener()
    this.messages.clear()
    this.closes.clear()
    this.queued.splice(0)
  }
}
