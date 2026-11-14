import { RefreshCw } from 'lucide-react'
import type { Agent } from '../../shared/generated/Agent'
import formStyles from '../../../docs/mockups/src/components/settings/AgentConnectForm.module.css'
import styles from '../../../docs/mockups/src/components/settings/EndpointModels.module.css'
import type { UnlistedModels } from '../../app/endpoint-models'
import { useServices } from '../../app/services'
import { useNow, whenOf } from '../../app/time'
import { useApp } from '../context'
import { ActionButton } from '../ui/actions'
import { useAction } from '../ui/useAction'
import { agentNames } from './labels'

/** Names in a sentence, such as "A", "A and B", or "A, B, and C". */
const names = new Intl.ListFormat('en', { type: 'conjunction' })

/**
 * What the pickers of the owner do with the models that the list leaves
 * out: they hide them, or they show them all when the list names none.
 */
function listText(unlisted: UnlistedModels): string {
  const labels = names.format(unlisted.models.map((model) => model.label))
  const one = unlisted.models.length === 1
  if (unlisted.noneListed) {
    return one
      ? `Your model pickers show ${labels}, but this endpoint does not list it.`
      : `Your model pickers show ${labels}, but this endpoint lists none of them.`
  }
  return one
    ? `${labels} is hidden from your model pickers, because this endpoint does not list it.`
    : `${labels} are hidden from your model pickers, because this endpoint does not list them.`
}

/**
 * The models of the app that the last model list of an own endpoint does
 * not name, under the host of the login: what the pickers of the owner do
 * with them, their IDs as code that the owner can copy into the setup of
 * the endpoint, and the time of the last read of the list. Refresh reads
 * the list again, and the line follows the new list.
 */
export function EndpointModels(props: {
  agent: Agent
  unlisted: UnlistedModels
}) {
  const app = useApp()
  const { timeZone } = useServices()
  const now = useNow(60_000)
  const name = agentNames[props.agent]
  const refresh = useAction(
    () => app.account.refreshModels(props.agent),
    `The model list of ${name} wasn't refreshed.`,
  )
  const { models, checkedAt } = props.unlisted
  const ids = names.formatToParts(models.map((model) => model.model))
  const checked = whenOf(now, checkedAt, timeZone)
  return (
    <div className={styles.models}>
      <div className={styles.text}>
        <span className={styles.label}>{listText(props.unlisted)}</span>
        <span className={styles.hint}>
          {models.length === 1 ? 'Its model ID is ' : 'Their model IDs are '}
          {ids.map((part, index) =>
            part.type === 'element' ? (
              <code className={formStyles.code} key={index}>
                {part.value}
              </code>
            ) : (
              part.value
            ),
          )}
          {`. Checked ${checked.kind === 'date' ? `on ${checked.text}` : checked.text}.`}
        </span>
      </div>
      <ActionButton
        accessibilityLabel={`Refresh the model list of ${name}`}
        busy={refresh.pending}
        icon={RefreshCw}
        onPress={refresh.run}
      >
        Refresh
      </ActionButton>
    </div>
  )
}
