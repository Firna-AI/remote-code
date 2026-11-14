import { readTurnSpeed } from '../../../../src/shared/chat-events'
import type { TurnSpeed } from '../generated/TurnSpeed'
import type { ProviderEvent } from '../generated/ProviderEvent'

/** Keep any standard-speed request across the results of one visible turn. */
export class ClaudeSpeed {
  private readonly emit: (event: ProviderEvent) => void
  private enabled: boolean
  private speed: TurnSpeed | undefined
  private overageCause: string | undefined
  private overageFallback = false

  constructor(emit: (event: ProviderEvent) => void, fast: boolean) {
    this.emit = emit
    this.enabled = fast
    if (fast) this.report({ state: 'fast' })
  }

  mode(fast: boolean): void {
    this.enabled = fast
    if (fast && !this.speed) this.report({ state: 'fast' })
  }

  accept(input: Record<string, unknown>): void {
    if (!this.enabled) return
    if (input.type === 'rate_limit_event') {
      const info = input.rate_limit_info
      if (typeof info !== 'object' || info === null) return
      const parsed = readTurnSpeed({
        state: 'standard',
        cause:
          'overageDisabledReason' in info
            ? info.overageDisabledReason
            : undefined,
      })
      this.overageCause =
        parsed?.state === 'standard' ? parsed.cause : undefined
      if (this.overageFallback) this.standard(this.overageCause)
    }
    if (input.type === 'system' && input.subtype === 'notification') {
      if (input.key === 'fast-mode-overage-rejected') {
        this.overageFallback = true
        this.standard(this.overageCause)
      }
      if (input.key === 'fast-mode-cooldown-started')
        this.standard('fast_limit')
      if (input.key === 'fast-mode-fallback-model-rejected') this.standard()
    }
    if (input.type === 'result') {
      if (input.fast_mode_state === 'cooldown') this.standard('fast_limit')
      else if (input.fast_mode_state === 'off') {
        const parsed = readTurnSpeed({
          state: 'standard',
          cause: input.fast_mode_disabled_reason,
        })
        this.standard(parsed?.state === 'standard' ? parsed.cause : undefined)
      }
    }
  }

  private standard(cause?: string): void {
    if (this.speed?.state === 'standard' && this.speed.cause) return
    this.report({ state: 'standard', ...(cause ? { cause } : {}) })
  }

  private report(speed: TurnSpeed): void {
    this.speed = speed
    this.emit({ type: 'speed', speed })
  }
}
