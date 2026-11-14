import type { AgentChoice } from '../src/generated/AgentChoice'
import type { ProviderEvent } from '../src/generated/ProviderEvent'
import type { ProviderInput } from '../src/generated/ProviderInput'
import type {
  ProviderFactory,
  ProviderOptions,
  ProviderProcess,
} from '../src/providers/types'

export class FakeProvider implements ProviderProcess {
  readonly options: ProviderOptions
  readonly messages: ProviderInput[] = []
  readonly choices: AgentChoice[] = []
  interrupts = 0
  closed = false

  constructor(options: ProviderOptions) {
    this.options = options
  }

  async send(input: ProviderInput) {
    this.messages.push(input)
  }

  async model(choice: AgentChoice): Promise<'applied' | 'deferred'> {
    this.choices.push(choice)
    return 'applied'
  }

  async interrupt() {
    this.interrupts++
  }

  async close() {
    this.closed = true
  }

  async stop() {
    this.closed = true
  }

  emit(event: ProviderEvent) {
    this.options.event(event)
  }
}

export class FakeProviders {
  readonly processes: FakeProvider[] = []
  readonly open: ProviderFactory = async (options) => {
    const provider = new FakeProvider(options)
    this.processes.push(provider)
    provider.emit({
      type: 'conversation',
      id: options.conversationId ?? 'new-conversation',
    })
    return provider
  }

  get latest(): FakeProvider {
    const provider = this.processes.at(-1)
    if (!provider) throw new Error('The test did not start a provider.')
    return provider
  }
}
