import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

import type { ClaudeQuery, ClaudeQueryFactory } from '../src/providers/claude'
import { InputQueue } from '../src/providers/queue'

export class FakeClaudeQuery implements ClaudeQuery {
  private readonly incoming = new InputQueue<{
    value: unknown
    done: () => void
  }>()
  private input: AsyncIterator<SDKUserMessage> | null = null
  parameters: Parameters<ClaudeQueryFactory>[0] | null = null
  readonly models: (string | undefined)[] = []
  readonly efforts: unknown[] = []
  interrupts = 0
  closed = false

  open: ClaudeQueryFactory = (parameters) => {
    this.parameters = parameters
    if (typeof parameters.prompt === 'string')
      throw new Error('The test requires streamed input.')
    this.input = parameters.prompt[Symbol.asyncIterator]()
    return this
  }

  async nextUser(): Promise<SDKUserMessage> {
    const next = await this.nextInput()
    if (next.done) throw new Error('The test did not submit a prompt.')
    return next.value
  }

  nextInput(): Promise<IteratorResult<SDKUserMessage>> {
    if (!this.input) throw new Error('The test did not open streamed input.')
    return this.input.next()
  }

  raw(value: unknown): Promise<void> {
    return new Promise((done) => this.incoming.push({ value, done }))
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
    for await (const item of this.incoming) {
      yield item.value
      item.done()
    }
  }

  async interrupt() {
    this.interrupts++
  }
  async setModel(model?: string) {
    this.models.push(model)
  }
  async setMaxThinkingTokens() {}
  async applyFlagSettings(settings: unknown) {
    this.efforts.push(settings)
  }
  close() {
    this.closed = true
    this.incoming.close()
  }
}
