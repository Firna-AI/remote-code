import type { SessionCronSummary } from '@anthropic-ai/claude-agent-sdk'

import type { ProviderEvent } from '../generated/ProviderEvent'

/** Process-local level signals. A removed task can still have a queued reply. */
export class ClaudeBackground {
  private tasks = new Set<string>()
  private ambient = new Set<string>()
  private crons: readonly SessionCronSummary[] = []
  private idle = false
  private readonly emit: (event: ProviderEvent) => void
  waited = false

  constructor(emit: (event: ProviderEvent) => void) {
    this.emit = emit
  }

  get live(): boolean {
    return this.tasks.size > 0 || this.crons.length > 0
  }

  result(allAnswered: boolean): void {
    if (allAnswered && this.live) this.waited = true
  }

  input(): void {
    this.waited = false
  }

  isAmbient(id: string): boolean {
    return this.ambient.has(id)
  }

  stop(crons: readonly SessionCronSummary[]): void {
    this.idle = false
    this.emit({ type: 'activity', idle: false })
    this.crons = crons
    this.publish()
  }

  accept(input: Record<string, unknown>): boolean {
    if (input.type !== 'system' || input.parent_tool_use_id) return false
    if (input.subtype === 'session_state_changed') {
      if (!['idle', 'running', 'requires_action'].includes(String(input.state)))
        return true
      this.idle = input.state === 'idle'
      this.emit({ type: 'activity', idle: this.idle })
      return true
    }
    if (input.subtype !== 'background_tasks_changed') return false
    const all = new Set<string>()
    const live = new Set<string>()
    const ambient = new Set<string>()
    for (const value of Array.isArray(input.tasks) ? input.tasks : []) {
      if (typeof value !== 'object' || value === null || !('task_id' in value))
        continue
      if (typeof value.task_id !== 'string') continue
      all.add(value.task_id)
      if (!('ambient' in value) || value.ambient !== true)
        live.add(value.task_id)
      else ambient.add(value.task_id)
    }
    // Becoming ambient needs no notification. Removal can precede its wake-up.
    if ([...this.tasks].some((id) => !all.has(id))) this.idle = false
    this.tasks = live
    this.ambient = ambient
    this.publish()
    return true
  }

  private publish(): void {
    this.emit({ type: 'background', live: this.live, idle: this.idle })
  }
}
