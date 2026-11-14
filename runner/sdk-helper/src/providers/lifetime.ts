import type { ChildProcess } from 'node:child_process'

const PROCESS_KILL_DELAY_MS = 5_000

type Child = Pick<
  ChildProcess,
  'pid' | 'exitCode' | 'signalCode' | 'kill' | 'once'
>

class ChildLifetime {
  readonly exited: Promise<void>
  private readonly child: Child
  private resolve: () => void = () => {}
  private ended = false
  private stopping = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(child: Child) {
    this.child = child
    this.exited = new Promise((resolve) => {
      this.resolve = resolve
    })
    child.once('exit', () => this.finish())
    child.once('error', () => {
      if (child.pid === undefined) this.finish()
    })
    if (child.exitCode !== null || child.signalCode !== null) this.finish()
  }

  close(): Promise<void> {
    if (!this.ended && !this.stopping) {
      this.stopping = true
      this.child.kill('SIGTERM')
      if (!this.ended)
        this.timer = setTimeout(() => {
          if (!this.ended) this.child.kill('SIGKILL')
        }, PROCESS_KILL_DELAY_MS)
    }
    return this.exited
  }

  private finish(): void {
    if (this.ended) return
    this.ended = true
    clearTimeout(this.timer)
    this.resolve()
  }
}

export class ProviderLifetime {
  private readonly children = new Set<ChildLifetime>()
  private readonly cleanups = new Set<() => Promise<void>>()
  private closing = false

  registerCleanup(cleanup: () => Promise<void>): void {
    let closing: Promise<void> | undefined
    this.cleanups.add(() => (closing ??= cleanup()))
  }

  register(child: Child): Promise<void> {
    const lifetime = new ChildLifetime(child)
    this.children.add(lifetime)
    void lifetime.exited.then(() => this.children.delete(lifetime))
    if (this.closing) void lifetime.close()
    return lifetime.exited
  }

  async close(): Promise<void> {
    this.closing = true
    try {
      await Promise.all([...this.children].map((child) => child.close()))
    } finally {
      await Promise.all([...this.cleanups].map((cleanup) => cleanup()))
    }
  }
}
