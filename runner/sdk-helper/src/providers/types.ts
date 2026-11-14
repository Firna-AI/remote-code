import type { AgentChoice } from '../generated/AgentChoice'
import type { HelperOptions } from '../generated/HelperOptions'
import type { ProviderEvent } from '../generated/ProviderEvent'
import type { ProviderInput } from '../generated/ProviderInput'
import type { ProviderLifetime } from './lifetime'

export interface ProviderProcess {
  send(input: ProviderInput): Promise<void>
  /** A deferred choice needs a new provider turn at the next safe boundary. */
  model(choice: AgentChoice): Promise<'applied' | 'deferred'>
  interrupt(): Promise<void>
  /** Ends the visible turn and all provider input still waiting to run. */
  stop(): Promise<void>
  close(): Promise<void>
}

export interface ProviderOptions extends Omit<
  HelperOptions,
  'backgroundNoteIds'
> {
  event: (event: ProviderEvent) => void
  warn: (message: string) => void
  signal?: AbortSignal
  lifetime?: ProviderLifetime
  /** Work already named by the Stop hook across process handoffs. */
  backgroundNoteIds?: Set<string>
  backgroundNotes?: (ids: readonly string[]) => void
}

export type ProviderFactory = (
  options: ProviderOptions,
) => Promise<ProviderProcess>
