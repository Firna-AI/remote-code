import type { Options } from '@anthropic-ai/claude-agent-sdk'

import type { AgentChoice } from '../generated/AgentChoice'
import type { Effort } from '../generated/Effort'

/** The effort levels that the Claude Agent SDK accepts. */
type ClaudeEffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** The flag settings that set the effort of a running Claude session. */
export type ClaudeEffortSettings = {
  effortLevel: ClaudeEffortLevel | null
  ultracode: boolean
}

/**
 * The effort level that Claude runs. The SDK has no "ultra" level: Ultra
 * runs the "max" level with Ultracode on. "none" runs with thinking off.
 */
function level(effort: Effort): ClaudeEffortLevel | null {
  if (effort === 'none') return null
  if (effort === 'ultra') return 'max'
  return effort
}

/** The `query()` options that start a Claude session at an effort. */
export function claudeStartOptions(
  effort: Effort,
): Pick<Options, 'effort' | 'thinking' | 'settings'> {
  const start = level(effort)
  if (start === null) return { thinking: { type: 'disabled' } }
  return effort === 'ultra'
    ? { effort: start, settings: { ultracode: true } }
    : { effort: start }
}

/**
 * The flag settings that move a running Claude session to an effort. The
 * settings always name Ultracode, because a change that keeps the level,
 * such as Ultra to Max, does not turn Ultracode off by itself.
 */
export function claudeEffortSettings(effort: Effort): ClaudeEffortSettings {
  return { effortLevel: level(effort), ultracode: effort === 'ultra' }
}

/**
 * The `query()` options that start a Claude session with a choice: its
 * effort, and the fast mode flag setting beside a setting of the effort.
 */
export function claudeStart(
  choice: AgentChoice,
): Pick<Options, 'effort' | 'thinking' | 'settings'> {
  const start = claudeStartOptions(choice.effort)
  // The start options set settings only as an object, never as a file path.
  const settings = typeof start.settings === 'object' ? start.settings : {}
  return { ...start, settings: { ...settings, fastMode: choice.fast } }
}
