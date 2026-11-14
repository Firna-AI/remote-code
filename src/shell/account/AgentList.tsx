import { useEffect, useId, useState, type ReactNode } from 'react'
import type { Agent } from '../../shared/generated/Agent'
import { classes } from '../../../docs/mockups/src/components/common/classes'
import { StatusText } from '../../../docs/mockups/src/components/common/StatusText'
import styles from '../../../docs/mockups/src/components/settings/AccountSections.module.css'
import { LoginEndpoint } from '../../../docs/mockups/src/components/settings/LoginEndpoint'
import { AGENTS } from '../../app/api/read-core'
import { unlistedModels } from '../../app/endpoint-models'
import { useStore } from '../../app/store'
import type { AccountResponse, AgentLoginStatus } from '../../shared/account'
import { useApp } from '../context'
import { ActionButton } from '../ui/actions'
import { useAction } from '../ui/useAction'
import { AgentConnectForm } from './AgentConnectForm'
import { EndpointModels } from './EndpointModels'
import { agentNames, loginLabels } from './labels'
import {
  LoginNotUsable,
  SignedOutStatus,
  unusableCause,
} from './LoginNotUsable'
import { LoginShareSetting } from './LoginShareSetting'

type ConnectedLogin = Extract<AgentLoginStatus, { connected: true }>

function connectedLogin(
  account: AccountResponse | null,
  agent: Agent,
): ConnectedLogin | null {
  const login = account?.agentLogins.find((item) => item.agent === agent)
  return login?.connected ? login : null
}

function AgentRow(props: {
  agent: Agent
  /** The id of the name of the agent, which names its share setting too. */
  nameId: string
  login: ConnectedLogin | null
  /** Why the app can no longer use the login, or `null` while it can. */
  cause: string | null
  formOpen: boolean
  removable: boolean
  disabled: boolean
  open: () => void
}) {
  const app = useApp()
  const name = agentNames[props.agent]
  const remove = useAction(
    () => app.account.removeLogin(props.agent),
    `${name} wasn't removed.`,
  )
  const { login } = props
  let action: ReactNode = null
  if (login && props.removable) {
    action = (
      <ActionButton
        accessibilityLabel={`Remove ${name}`}
        busy={remove.pending}
        onPress={remove.run}
        tone="plain"
      >
        Remove
      </ActionButton>
    )
  } else if (!login && !props.formOpen) {
    action = (
      <ActionButton
        accessibilityLabel={`Connect ${name}`}
        disabled={props.disabled}
        onPress={props.open}
      >
        Connect
      </ActionButton>
    )
  }
  return (
    <div className={classes(styles.row, styles.agentRow)}>
      <span className={styles.name} id={props.nameId}>
        {name}
      </span>
      <span className={styles.detail}>
        {login ? (
          <>
            {props.cause === null ? (
              <StatusText label="Connected" tone="success" />
            ) : (
              <SignedOutStatus />
            )}
            {login.kind === 'endpoint' ? null : (
              <span className={styles.kind}>
                {loginLabels[login.agent][login.kind]}
              </span>
            )}
          </>
        ) : null}
      </span>
      {action}
    </div>
  )
}

/**
 * Claude and Codex, each with Connect, or Connected and the kind of its
 * login. An own endpoint login shows its kind with the host of its endpoint
 * under its row, so that a phone shows both in full. Under them come the
 * models of the app that the last model list of the endpoint does not name,
 * with Refresh. Connect opens the form of the agent under its row, one form
 * at a time. `initial` opens a form at first. `removable` gives each
 * connected login its Remove, and `shares` its share setting, as on the
 * account. `closable` gives each form its Cancel. `disabled` turns Connect
 * off, as in a later step of Get started.
 *
 * A login that the app can no longer use says Signed out in place of
 * Connected, with its cause and Sign in again under its row. Sign in again,
 * and `initial`, open the form of its agent with the kind of the login, in
 * the place of the cause. Each open of the list reads the logins again, so
 * that a login that stopped after the app opened shows Signed out.
 */
export function AgentList(props: {
  initial: Agent | null
  removable: boolean
  shares?: boolean
  closable: boolean
  disabled?: boolean
  /** Runs after a save, such as the refresh of Get started. */
  connected?: () => void
}) {
  const app = useApp()
  const account = useStore(app.account.account)
  const models = useStore(app.models)
  useEffect(() => {
    void app.account.refreshLogins()
  }, [app])
  const [open, setOpen] = useState<Agent | null>(props.initial)
  const ids = useId()
  const close = () => setOpen(null)
  const disabled = props.disabled ?? false
  return (
    <ul aria-label="Agents" className={classes(styles.list, styles.agentList)}>
      {AGENTS.map((agent) => {
        const login = connectedLogin(account, agent)
        const cause = unusableCause(login)
        const formOpen = open === agent && (login === null || cause !== null)
        const nameId = `${ids}-${agent}`
        const unlisted = login ? unlistedModels(models, login) : null
        return (
          <li key={agent}>
            <AgentRow
              agent={agent}
              cause={cause}
              disabled={disabled}
              formOpen={formOpen}
              login={login}
              nameId={nameId}
              open={() => setOpen(agent)}
              removable={props.removable}
            />
            {login?.kind === 'endpoint' ? (
              <LoginEndpoint
                host={login.host}
                kind={loginLabels[agent].endpoint}
              />
            ) : null}
            {unlisted ? (
              <EndpointModels agent={agent} unlisted={unlisted} />
            ) : null}
            {cause !== null && !formOpen ? (
              <LoginNotUsable
                cause={cause}
                disabled={disabled}
                signInAgain={() => setOpen(agent)}
              />
            ) : null}
            {formOpen ? (
              <AgentConnectForm
                agent={agent}
                close={props.closable ? close : undefined}
                connected={() => {
                  close()
                  props.connected?.()
                }}
                kind={login?.kind}
              />
            ) : null}
            {login && props.shares ? (
              <LoginShareSetting
                agent={agent}
                nameId={nameId}
                noReuse={login.noReuse}
              />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
