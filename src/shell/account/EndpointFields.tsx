import { Input } from '@firna/ui/input'
import type { Agent } from '../../shared/generated/Agent'
import { productName } from '../../../docs/mockups/src/brand'
import { useControlSizes } from '../../../docs/mockups/src/components/common/touch'
import styles from '../../../docs/mockups/src/components/settings/AgentConnectForm.module.css'
import type { SecretForm } from '../../app/secret-form'
import { useStore } from '../../app/store'
import {
  ENDPOINT_ADDRESS_ERROR,
  readEndpointAddress,
} from '../../shared/endpoint-address'
import { useApp } from '../context'
import { SecretField } from './SecretFields'

/**
 * The API that the endpoint of each agent serves, the example of its base
 * address, and the route that the gateway of the app adds to the base for
 * each request. A Claude base has no `/v1`, and a Codex base ends with it.
 */
const endpointApis = {
  claude: {
    name: 'the Anthropic Messages API',
    example: 'https://gateway.example.com',
    route: '/v1/messages',
  },
  codex: {
    name: 'the OpenAI Responses API',
    example: 'https://gateway.example.com/v1',
    route: '/responses',
  },
} as const satisfies Record<
  Agent,
  { name: string; example: string; route: string }
>

/** Names in a sentence, such as "A", "A and B", or "A, B, and C". */
const names = new Intl.ListFormat('en', { type: 'conjunction' })

/** What the endpoint must serve, with the models of the app for the agent. */
function servesText(agent: Agent, labels: readonly string[]): string {
  const offered =
    labels.length > 0
      ? `, with the models that ${productName} offers: ${names.format(labels)}`
      : ''
  return `Use a gateway or a proxy that serves ${endpointApis[agent].name}${offered}.`
}

/**
 * The hint under the address: where the requests of the agent go, through
 * the gateway of the app. It follows the typed address from the moment that
 * the shared rule accepts it, and shows the example until then. When the
 * rule changes the typed address, the hint first names the address that
 * the form saves.
 */
function addressHint(agent: Agent, typed: string): string {
  const api = endpointApis[agent]
  const requests = (upstream: string) =>
    `Requests go through ${productName} to ${upstream}.`
  const address = readEndpointAddress(typed, agent, { route: api.route })
  if (!address) return requests(`${api.example}${api.route}`)
  const saves =
    address.endpoint === typed.trim() ? '' : `Saves as ${address.endpoint}. `
  return `${saves}${requests(address.upstream)}`
}

/**
 * Why the form keeps an address from the save: an empty field, or an
 * address that the shared rule of the save refuses. Null when the rule
 * accepts it.
 */
export function addressProblem(agent: Agent, typed: string): string | null {
  if (typed.trim() === '') return 'Enter the endpoint first.'
  if (readEndpointAddress(typed, agent)) return null
  return ENDPOINT_ADDRESS_ERROR.message
}

/**
 * The fields of an own endpoint login: what the endpoint must serve, with
 * the models that the app offers, its address, and its key. The hint of the
 * address names the exact address of the requests, and a refusal of the
 * address takes the place of that hint. `form` holds the key.
 */
export function EndpointFields(props: {
  agent: Agent
  form: SecretForm
  address: string
  refusal: string | null
  changeAddress: (address: string) => void
  submit: () => void
}) {
  const app = useApp()
  const models = useStore(app.models)
  const state = useStore(props.form.state)
  const { field } = useControlSizes()
  const labels = models
    .filter((model) => model.agent === props.agent)
    .map((model) => model.label)
  return (
    <>
      <p className={styles.text}>{servesText(props.agent, labels)}</p>
      <Input
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        editable={!state.saving}
        error={props.refusal}
        hint={
          props.refusal ? undefined : addressHint(props.agent, props.address)
        }
        inputMode="url"
        label="Endpoint"
        onChangeText={props.changeAddress}
        onSubmitEditing={props.submit}
        placeholder={endpointApis[props.agent].example}
        size={field}
        value={props.address}
      />
      <SecretField
        agent={props.agent}
        form={props.form}
        kind="endpoint"
        submit={props.submit}
      />
    </>
  )
}
