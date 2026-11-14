import type { Workspace } from '../shared/generated/Workspace'
import { useCallback, useState } from 'react'
import { nameLabel } from '../shared/name-label'

import type { MembersApi } from './api/client'
import { useOwnerChoices } from './OwnerChoices'
import { OwnerButton, ReadOnlyOwner } from './OwnerButton'
import { ChoiceMenu } from './ui/ChoiceMenu'
import { ViewportScope, type Viewport } from './ui/controls'

export type OwnerPickerProps = {
  api: MembersApi
  workspace: Workspace
  /** The signed-in person is an admin of the org. */
  canReassign: boolean
  viewport: Viewport
  /** The owner changed. The workspace is the API's answer. */
  onReassigned: (workspace: Workspace) => void
}

/**
 * The owner of a workspace, for its header: the avatar and the name, or the
 * avatar alone on a phone. An admin opens a menu of every member of the org,
 * with the current owner checked, and picks another owner. A phone shows the
 * menu as a sheet. A new owner changes no login and does not restart the
 * cloud computer. A member who is not an admin sees the owner only.
 *
 * The picker keys its state to the workspace, its org, and `canReassign`.
 * When one of them changes, the menu closes and the list of members goes.
 * The answers of older requests then change nothing and call no callback.
 */
export function OwnerPicker(props: OwnerPickerProps) {
  const { workspace } = props
  const scope = `${workspace.orgId}/${workspace.id}/${props.canReassign}`
  return <ScopedOwnerPicker key={scope} {...props} />
}

function ScopedOwnerPicker(props: OwnerPickerProps) {
  const { api, workspace } = props
  const compact = props.viewport === 'mobile'
  const [open, setOpen] = useState(false)
  const choices = useOwnerChoices({
    api,
    workspace,
    onReassigned: props.onReassigned,
    close: () => setOpen(false),
  })
  const show = choices.open
  const changeOpen = useCallback(
    (next: boolean) => {
      setOpen(next)
      if (next) show()
    },
    [show],
  )

  if (!props.canReassign) {
    return (
      <ViewportScope inline viewport={props.viewport}>
        <ReadOnlyOwner compact={compact} workspace={workspace} />
      </ViewportScope>
    )
  }
  return (
    <ViewportScope inline viewport={props.viewport}>
      <ChoiceMenu
        {...choices.panel}
        align="end"
        onOpenChange={changeOpen}
        open={open}
        sheetTitle={nameLabel(workspace.name)}
        trigger={(trigger) => (
          <OwnerButton
            busy={choices.busy}
            compact={compact}
            trigger={trigger}
            workspace={workspace}
          />
        )}
        wide
      />
    </ViewportScope>
  )
}
