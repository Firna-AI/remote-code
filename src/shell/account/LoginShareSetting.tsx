import { useState } from 'react'
import type { Agent } from '../../shared/generated/Agent'
import { LoginShare } from '../../../docs/mockups/src/components/settings/LoginShare'
import { useApp } from '../context'
import { useAction } from '../ui/useAction'

/**
 * The share setting of a connected login of the account, which saves at
 * once. `noReuse` is the saved value: other members' messages in the
 * sessions of the user do not run on the login. While a change saves, the
 * switch shows the new value and takes no other change. A change that the
 * app did not save shows its cause under the switch until the next change,
 * and the switch shows the saved value again. `nameId` is the id of the
 * name of the agent in its row.
 */
export function LoginShareSetting(props: {
  agent: Agent
  noReuse: boolean
  nameId: string
}) {
  const app = useApp()
  const [requested, setRequested] = useState(!props.noReuse)
  const save = useAction((shared: boolean) =>
    app.account.setNoReuse(props.agent, !shared),
  )
  const change = (shared: boolean) => {
    if (save.pending) return
    setRequested(shared)
    save.run(shared)
  }
  return (
    <LoginShare
      error={save.error?.message ?? null}
      nameId={props.nameId}
      onChange={change}
      saving={save.pending}
      shared={save.pending ? requested : !props.noReuse}
    />
  )
}
