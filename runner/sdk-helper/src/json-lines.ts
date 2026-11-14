import { StringDecoder } from 'node:string_decoder'

/** Frames UTF-8 input without treating a partial line as a message. */
export class JsonLines<T> {
  private readonly decoder = new StringDecoder('utf8')
  private pending = ''

  private readonly read: (value: unknown) => T
  private readonly accept: (message: T) => void

  constructor(read: (value: unknown) => T, accept: (message: T) => void) {
    this.read = read
    this.accept = accept
  }

  push(chunk: Buffer): void {
    this.pending += this.decoder.write(chunk)
    for (;;) {
      const end = this.pending.indexOf('\n')
      if (end < 0) return
      const line = this.pending.slice(0, end)
      this.pending = this.pending.slice(end + 1)
      const value: unknown = JSON.parse(line)
      this.accept(this.read(value))
    }
  }

  end(): void {
    this.pending += this.decoder.end()
    if (this.pending.length)
      throw new Error('The helper JSON line is incomplete.')
  }
}
