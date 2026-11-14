import { useState } from 'react'
import { SegmentedControl } from '@firna/ui/segmented'
import { TriangleAlert } from 'lucide-react'
import type { Agent } from '../../shared/generated/Agent'
import { Notice } from '../../../docs/mockups/src/components/common/Notice'
import { useControlSizes } from '../../../docs/mockups/src/components/common/touch'
import styles from '../../../docs/mockups/src/components/settings/AgentConnectForm.module.css'
import { SecretForm } from '../../app/secret-form'
import { useStore } from '../../app/store'
import type { SaveAgentLoginRequest } from '../../shared/account'
import { useApp } from '../context'
import { ActionButton } from '../ui/actions'
import { addressProblem, EndpointFields } from './EndpointFields'
import { ChatGptSignIn } from './ChatGptSignIn'
import {
  agentLoginKinds,
  agentNames,
  loginLabels,
  type LoginKind,
} from './labels'
import { refusesAddress, SecretField, SecretText } from './SecretFields'

function loginRequest(
  agent: Agent,
  kind: LoginKind,
  secret: string,
  endpoint: string,
): SaveAgentLoginRequest {
  if (kind === 'endpoint') return { agent, kind, endpoint, secret }
  if (agent === 'claude') return { agent, kind, secret }
  return { agent, kind: 'api-key', secret }
}

/**
 * The form that connects an agent, open under its row: Claude with a
 * subscription token, an API key, or an own endpoint, and Codex with an
 * OpenAI API key, a ChatGPT plan, or an own endpoint. On a phone the kinds wrap onto a
 * second line. The secret leaves the browser once, in the save. The form
 * checks the address of an own endpoint with the rule of the save, and
 * shows a refusal at the address before any request. A failed save keeps
 * the secret in the field and shows why. Cancel shows when `close` is set.
 */
export function AgentConnectForm(props: {
  agent: Agent
  kind?: LoginKind
  close?: () => void
  connected: () => void
}) {
  const app = useApp()
  const { field } = useControlSizes()
  const [form] = useState(() => new SecretForm())
  const kinds = agentLoginKinds[props.agent]
  const [kind, setKind] = useState<LoginKind>(props.kind ?? kinds[0])
  const [address, setAddress] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const state = useStore(form.state)
  const submit = () => {
    if (kind === 'endpoint') {
      const problem = addressProblem(props.agent, address)
      setRefusal(problem)
      if (problem !== null) return
    }
    const request = (secret: string) =>
      loginRequest(props.agent, kind, secret, address.trim())
    void form
      .submit((secret) => app.account.saveLogin(request(secret)))
      .then((saved) => {
        const { error } = form.state.get()
        if (saved) props.connected()
        else if (error && refusesAddress(error)) setRefusal(error.message)
      })
  }
  return (
    <div className={styles.form}>
      <SegmentedControl
        accessibilityLabel="Connect with"
        disabled={state.saving}
        onChange={setKind}
        options={kinds.map((item) => ({
          label: loginLabels[props.agent][item],
          value: item,
        }))}
        size={field}
        value={kind}
        wrap
      />
      {props.agent === 'codex' && kind === 'token' ? (
        <ChatGptSignIn close={props.close} connected={props.connected} />
      ) : (
        <>
          {kind === 'endpoint' ? (
            <EndpointFields
              address={address}
              agent={props.agent}
              changeAddress={(text) => {
                setAddress(text)
                setRefusal(null)
              }}
              form={form}
              refusal={refusal}
              submit={submit}
            />
          ) : (
            <>
              <SecretText agent={props.agent} kind={kind} />
              <SecretField
                agent={props.agent}
                form={form}
                kind={kind}
                submit={submit}
              />
            </>
          )}
          {state.error && !refusesAddress(state.error) ? (
            <Notice
              body={state.error.message}
              icon={TriangleAlert}
              title={`${agentNames[props.agent]} wasn't connected`}
              tone="danger"
            />
          ) : null}
          <div className={styles.actions}>
            {props.close ? (
              <ActionButton disabled={state.saving} onPress={props.close}>
                Cancel
              </ActionButton>
            ) : null}
            <ActionButton busy={state.saving} onPress={submit} tone="primary">
              Connect
            </ActionButton>
          </div>
        </>
      )}
    </div>
  )
}
