import type { Workspace } from '../shared/generated/Workspace'
import { useCallback, useRef, useState } from 'react'
import type { OrgMember } from '../shared/members'

import { errorMessage, type MembersApi } from './api/client'
import { personName } from './people'
import { useMountedRef } from './useMounted'
import styles from './ui/ChoiceMenu.module.css'
import { MenuPanel, type MenuChoice } from './ui/MenuPanel'
import { PersonAvatar } from './ui/PersonAvatar'

/**
 * Each session runs on the agent login of its starter, the member who
 * started it.
 */
const loginNote =
  'Each session runs on the agent login of the member who started it.'

type Members =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; members: readonly OrgMember[] }

/** The line in place of the members while they load or after a failure. */
function statusText(members: Members): string | undefined {
  if (members.status === 'loading') return 'Loading the members'
  if (members.status === 'failed') return 'The members did not load.'
  return undefined
}

/** The members of the org as choices of a new owner, and their states. */
export interface OwnerChoicesState {
  /** The choices open: an old error goes, and the members load again. */
  open: () => void
  /** A change of the owner runs, so the menu of the choices stays open. */
  busy: boolean
  /** The props of the panel of the choices. */
  panel: {
    label: string
    group: string
    choices: readonly MenuChoice<string>[]
    selected: string
    busy: string | null
    status?: string
    error?: string
    note: string
    onSelect: (userId: string) => void
  }
}

/**
 * The members whom an admin can make the owner of a workspace, as the owner
 * picker of the header and the menu of a workspace row show them. A list
 * that loaded before stays while it loads again. Only the newest load of a
 * mounted owner changes the list. A choice of the owner closes the menu. A
 * choice of another member sends the change, and the menu stays open until
 * the reply: the answer goes to `onReassigned` and the menu closes, or the
 * error shows in the menu. A new owner changes no login and does not
 * restart the cloud computer.
 */
export function useOwnerChoices(props: {
  api: MembersApi
  workspace: Workspace
  /** The owner changed. The workspace is the API's answer. */
  onReassigned: (workspace: Workspace) => void
  /** Closes the menu of the choices. */
  close: () => void
}): OwnerChoicesState {
  const { api, workspace } = props
  const mounted = useMountedRef()
  const loads = useRef(0)
  const [members, setMembers] = useState<Members>({ status: 'loading' })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const open = useCallback(() => {
    setError(null)
    setMembers((current) =>
      current.status === 'failed' ? { status: 'loading' } : current,
    )
    const load = ++loads.current
    const newest = () => mounted.current && load === loads.current
    api.members(workspace.orgId).then(
      (response) => {
        if (newest()) setMembers({ status: 'ready', members: response.members })
      },
      (reason: unknown) => {
        if (newest())
          setMembers({ status: 'failed', message: errorMessage(reason) })
      },
    )
  }, [api, workspace.orgId, mounted])

  async function select(userId: string) {
    if (userId === workspace.owner.id) {
      props.close()
      return
    }
    setBusy(userId)
    setError(null)
    try {
      const updated = await api.reassignWorkspace(
        workspace.orgId,
        workspace.id,
        { userId },
      )
      if (!mounted.current) return
      props.close()
      props.onReassigned(updated)
    } catch (reason) {
      if (mounted.current) {
        setError(`The owner did not change. ${errorMessage(reason)}`)
      }
    } finally {
      if (mounted.current) setBusy(null)
    }
  }

  const list = members.status === 'ready' ? members.members : []
  return {
    open,
    busy: busy !== null,
    panel: {
      label: 'Owner',
      group: 'Owner',
      choices: list.map((member) => ({
        value: member.user.id,
        label: personName(member.user),
        mark: <PersonAvatar person={member.user} size={18} />,
      })),
      selected: workspace.owner.id,
      busy,
      status: statusText(members),
      error:
        members.status === 'failed' ? members.message : (error ?? undefined),
      note: loginNote,
      onSelect: (userId) => void select(userId),
    },
  }
}

/**
 * The owner choices in a menu of the app shell, such as the menu of a
 * workspace row: beside the menu on desktop, whose box holds them, or in a
 * phone sheet. The menu that holds them moves the focus into them, so a
 * hover that shows them leaves the focus where it is.
 */
export function OwnerChoices(props: {
  choices: OwnerChoicesState
  layout: 'menu' | 'sheet'
}) {
  return (
    <div className={props.layout === 'sheet' ? styles.sheet : styles.panel}>
      <MenuPanel {...props.choices.panel} autoFocus={false} />
    </div>
  )
}
