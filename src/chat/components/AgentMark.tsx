import type { Agent } from '../../shared/generated/Agent'
import styles from '../../../docs/mockups/src/components/chat/AgentMark.module.css'

/** The names of the agents, for marks, notices, and screen readers. */
export const agentNames: Readonly<Record<Agent, string>> = {
  claude: 'Claude',
  codex: 'Codex',
}

/** Two letters for each agent, in place of a brand logo. */
const letters: Readonly<Record<Agent, string>> = { claude: 'CL', codex: 'CX' }

/**
 * The mark of an agent: its two letters on a small tile, in the label font.
 * The app draws no brand logo. The mark names the agent to screen readers.
 */
export function AgentMark(props: { agent: Agent }) {
  return (
    <span
      aria-label={agentNames[props.agent]}
      className={styles.mark}
      role="img"
      title={agentNames[props.agent]}
    >
      {letters[props.agent]}
    </span>
  )
}
