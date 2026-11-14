import { Input } from '@firna/ui/input'
import type { Agent } from '../../shared/generated/Agent'
import { productName } from '../../../docs/mockups/src/brand'
import { useControlSizes } from '../../../docs/mockups/src/components/common/touch'
import styles from '../../../docs/mockups/src/components/settings/AgentConnectForm.module.css'
import type { ApiError } from '../../app/api/client'
import type { SecretForm } from '../../app/secret-form'
import { useStore } from '../../app/store'
import { ENDPOINT_ADDRESS_ERROR } from '../../shared/endpoint-address'
import { ExternalLink } from '../ui/links'
import { loginLabels, type LoginKind } from './labels'

/** The pages where a user makes an API key for Claude and for Codex. */
const keyPages = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openAi: 'https://platform.openai.com/api-keys',
} as const

/** The agent login API stores the secret without a test of it. */
const keepHint = `${productName} keeps it encrypted, and never shows it again.`

/**
 * Whether a failed save refused the address of an own endpoint. The form
 * shows that refusal at the address, not at the key.
 */
export function refusesAddress(error: ApiError | null): boolean {
  return error?.code === ENDPOINT_ADDRESS_ERROR.code
}

/** The field of the secret, by the agent and the kind of its login. */
function fieldOf(agent: Agent, kind: LoginKind) {
  if (kind === 'endpoint') {
    return { label: 'API key', placeholder: 'Paste the key' }
  }
  if (agent === 'codex') {
    return { label: 'OpenAI API key', placeholder: 'Paste the key' }
  }
  if (kind === 'api-key') {
    return { label: 'Anthropic API key', placeholder: 'Paste the key' }
  }
  return { label: loginLabels.claude.token, placeholder: 'Paste the token' }
}

/** What to paste for a token or an API key, and where the user gets it. */
export function SecretText(props: { agent: Agent; kind: LoginKind }) {
  if (props.agent === 'codex') {
    return (
      <p className={styles.text}>
        Paste an API key of your OpenAI account.{' '}
        <ExternalLink href={keyPages.openAi}>Make one on OpenAI</ExternalLink>
      </p>
    )
  }
  if (props.kind === 'api-key') {
    return (
      <p className={styles.text}>
        Paste an API key of your Anthropic account.{' '}
        <ExternalLink href={keyPages.anthropic}>
          Make one on Anthropic
        </ExternalLink>
      </p>
    )
  }
  return (
    <p className={styles.text}>
      Run <code className={styles.code}>claude setup-token</code> on your
      computer, then paste the token that it prints.
    </p>
  )
}

/** The field of a secret. A pasted secret shows only as dots. */
export function SecretField(props: {
  form: SecretForm
  agent: Agent
  kind: LoginKind
  submit: () => void
}) {
  const { field } = useControlSizes()
  const value = useStore(props.form.value)
  const state = useStore(props.form.state)
  const { label, placeholder } = fieldOf(props.agent, props.kind)
  return (
    <Input
      autoComplete="off"
      editable={!state.saving}
      error={state.missing ? `${placeholder} first.` : null}
      hint={keepHint}
      invalid={state.error !== null && !refusesAddress(state.error)}
      label={label}
      onChangeText={(text) => props.form.set(text)}
      onSubmitEditing={props.submit}
      placeholder={placeholder}
      secureTextEntry
      size={field}
      value={value}
    />
  )
}
