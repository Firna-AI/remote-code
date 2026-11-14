import type { Workspace } from '../../shared/generated/Workspace'
import type { WorkspaceState } from '../../shared/generated/WorkspaceState'
import { useEffect, type ReactNode } from 'react'
import { ChevronLeft, FolderGit2 } from 'lucide-react'
import { classes } from '../../../docs/mockups/src/components/common/classes'
import { StatusGlyph } from '../../../docs/mockups/src/components/workspaces/StatusGlyph'
import { activityPresentation } from '../../../docs/mockups/src/components/workspaces/status'
import owner from '../../../docs/mockups/src/components/workspace/OwnerPicker.module.css'
import styles from '../../../docs/mockups/src/components/workspace/WorkspaceHeader.module.css'
import { personName } from '../../app/people'
import { routes } from '../../app/router'
import { useStore, valueOf } from '../../app/store'
import { nameLabel } from '../../shared/name-label'

import { useOrgModel } from '../context'
import { useMacBar } from '../mac/mac-app'
import { IconButton } from '../ui/actions'
import { useGo } from '../ui/AppLink'
import { PersonAvatar } from '../ui/Avatars'
import ui from '../ui/ui.module.css'
import { CopyLink } from './CopyLink'
import type { WorkspaceContext } from './features'
import { RightColumnToggle } from './WorkspaceColumns'
import { RunLine } from './RunLine'
import { useRunRoutine } from './saved-view'

/** The owner of the workspace, without the menu that reassigns it. */
function Owner(props: { workspace: Workspace; compact: boolean }) {
  const person = props.workspace.owner
  return (
    <span className={owner.plain} title={`Owner: ${personName(person)}`}>
      <PersonAvatar person={person} size={props.compact ? 24 : 18} />
      {props.compact ? null : (
        <span className={owner.name}>{personName(person)}</span>
      )}
      <span className={ui.hidden}>, owner of the workspace</span>
    </span>
  )
}

function State(props: { state: WorkspaceState }) {
  return (
    <span className={styles.state}>
      <StatusGlyph status={props.state} />
      {activityPresentation[props.state].label}
    </span>
  )
}

/**
 * The name, number, repository, owner, and state of the open
 * workspace. A workspace
 * with no name yet shows Untitled. The label of the number copies the link
 * of the workspace. On desktop it follows the name, and the repository
 * takes the room that the other parts leave. On a phone it leads
 * the line under the name. The list groups workspaces by section, so the
 * header names the repository. On desktop the header ends with the toggle
 * of the right column. A run workspace links to its routine below it.
 * While the open of the workspace resumes its sandbox, the state shows
 * Starting at once, before the Resume reply.
 */
export function WorkspaceHeader(props: {
  context: WorkspaceContext
  /** The owner picker of Milestone 15c. Without it the owner shows read-only. */
  ownerControl?: ReactNode
}) {
  const { workspace, org } = props.context
  const model = useOrgModel(org.id)
  const repositories = valueOf(useStore(model.repositories))
  const go = useGo()
  const bar = useMacBar()
  const routine = useRunRoutine(props.context.savedView)
  useEffect(() => model.watch('repositories'), [model])
  const repository =
    repositories?.find((item) => item.id === workspace.repositoryId)
      ?.fullName ?? workspace.repositoryId
  const name = nameLabel(workspace.name)
  const phone = props.context.viewport === 'phone'
  const state = props.context.resumingAtOpen ? 'starting' : workspace.state
  const ownerView = props.ownerControl ?? (
    <Owner compact={phone} workspace={workspace} />
  )
  const copyLink = (
    <CopyLink inline={phone} key={workspace.link} workspace={workspace} />
  )
  const header = phone ? (
    <header className={styles.mobile}>
      <IconButton
        icon={ChevronLeft}
        label="All workspaces"
        onPress={() => go(routes.org(org.id))}
      />
      <div className={styles.titles}>
        <h1 className={styles.title}>{name}</h1>
        <span className={styles.line}>
          {copyLink}
          <span className={styles.branch}>{repository}</span>
        </span>
      </div>
      {ownerView}
      <State state={state} />
    </header>
  ) : (
    <header className={classes(styles.bar, bar)}>
      <h1 className={styles.title}>{name}</h1>
      {copyLink}
      <span className={styles.metas}>
        <span className={styles.meta}>
          <FolderGit2 aria-hidden className={styles.icon} size={13} />
          <span className={styles.branch}>{repository}</span>
        </span>
      </span>
      {ownerView}
      <State state={state} />
      <RightColumnToggle />
    </header>
  )
  if (!routine) return header
  return (
    <>
      {header}
      <RunLine orgId={org.id} routine={routine} />
    </>
  )
}
