export class InputQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private wake: (() => void) | null = null
  private ended = false

  push(value: T): void {
    if (this.ended) throw new Error('The agent input is closed.')
    this.values.push(value)
    this.wake?.()
  }

  close(): void {
    this.ended = true
    this.wake?.()
  }

  discard(): void {
    this.values.length = 0
    this.close()
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    for (;;) {
      const value = this.values.shift()
      if (value !== undefined) {
        yield value
        continue
      }
      if (this.ended) return
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
      this.wake = null
    }
  }
}
