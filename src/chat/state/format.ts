import type { AgentModel } from '../../shared/generated/AgentModel'
import type { Effort } from '../../shared/generated/Effort'
import { effortLabels } from '../../shared/agents'

const effortOrder = Object.keys(effortLabels)

/** The time since a moment, such as "now", "5m ago", or "1d ago". */
export function formatAgo(then: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - then) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** A day such as "5 November". */
export function formatDay(timestamp: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(new Date(timestamp))
}

/**
 * The effort that a model keeps after a change of model: the same level when
 * the model has it, else the nearest level below, else its lowest level.
 */
export function effortFor(model: AgentModel, wanted: Effort): Effort {
  if (model.efforts.includes(wanted)) return wanted
  const rank = (effort: Effort) => effortOrder.indexOf(effort)
  const sorted = [...model.efforts].sort(
    (left, right) => rank(left) - rank(right),
  )
  return (
    sorted.filter((effort) => rank(effort) < rank(wanted)).at(-1) ??
    sorted[0] ??
    wanted
  )
}

/**
 * The fast mode that a model keeps: on only when it was on and the model
 * list marks the model as fast. A model that the list does not hold has
 * fast mode off, so the picker shows only a speed that the agent can give.
 */
export function fastFor(
  model: AgentModel | undefined,
  wanted: boolean,
): boolean {
  return wanted && model?.fast === true
}
