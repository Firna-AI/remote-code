import type { Workspace } from '../../shared/generated/Workspace'
import type { WorkspaceState } from '../../shared/generated/WorkspaceState'
import { useCallback, useState } from 'react'
import { FolderGit2, GitBranch } from 'lucide-react'
import { useFileDropGuard } from '../../app/file-drags'
import { nameLabel } from '../../shared/name-label'

import { StatusGlyph } from '../../../docs/mockups/src/components/workspaces/StatusGlyph'
import header from '../../../docs/mockups/src/components/workspace/WorkspaceHeader.module.css'
import { ThisMacSection } from '../device/ThisMacSection'
import type { Clock } from '../ui/clock'
import { WorkspaceChat } from '../WorkspaceChat'
import type { DevBackend } from './dev-backend'
import { devMentions } from './dev-mentions'
import type { DevOptions } from './dev-options'
import { DevControls } from './DevControls'
import { DevMacBanner } from './DevMacBanner'
import styles from './DevPage.module.css'

const stateLabels: Readonly<Record<WorkspaceState, string>> = {
  working: 'Working',
  input: 'Needs input',
  unread: 'Done, unread',
  ready: 'Ready',
  starting: 'Starting',
  stopped: 'Stopped',
  error: "Couldn't start",
  archived: 'Archived',
}

/**
 * A stand-in for the app's workspace header, so the page shows the name and
 * the state that the chat reports, such as Untitled and then the title of a
 * new workspace.
 */
function DevHeader(props: { workspace: Workspace; mobile: boolean }) {
  const { workspace } = props
  const name = nameLabel(workspace.name)
  const state = (
    <span className={header.state}>
      <StatusGlyph status={workspace.state} />
      {stateLabels[workspace.state]}
    </span>
  )
  if (props.mobile) {
    return (
      <header className={header.mobile}>
        <span className={styles.back} />
        <div className={header.titles}>
          <h1 className={header.title}>{name}</h1>
          <span className={header.branch}>
            acme/storefront · {workspace.branch}
          </span>
        </div>
        {state}
      </header>
    )
  }
  return (
    <header className={header.bar}>
      <h1 className={header.title}>{name}</h1>
      <span className={header.meta}>
        <FolderGit2 aria-hidden className={header.icon} size={13} />
        <span className={header.branch}>acme/storefront</span>
      </span>
      <span className={header.meta}>
        <GitBranch aria-hidden className={header.icon} size={13} />
        <span className={header.branch}>{workspace.branch}</span>
      </span>
      <span className={header.spacer} />
      {state}
    </header>
  )
}

/**
 * The development page of the chat: the chat of one fake workspace in the
 * place that the app gives it, with controls for the recorded state and
 * live events. The desktop layout keeps the mockup's columns, so the chat
 * column is 718 px wide in a 1440 px window. As in the app, a drop of files
 * outside the message box does nothing.
 */
export function DevPage(props: {
  backend: DevBackend
  options: DevOptions
  clock: Clock
}) {
  const { backend, options } = props
  const [workspace, setWorkspace] = useState(backend.workspace)
  const [log, setLog] = useState<readonly string[]>([])
  const note = useCallback(
    (line: string) => setLog((lines) => [line, ...lines].slice(0, 6)),
    [],
  )
  const [mentions] = useState(() => devMentions(note))
  const mobile = options.viewport === 'mobile'
  useFileDropGuard()
  const chat = (
    <WorkspaceChat
      client={backend.client}
      clock={props.clock}
      mentions={mentions}
      onConnectAgent={(agent) =>
        note(`The app opens the Connect form of ${agent}.`)
      }
      onOpenDiff={(path) => note(`The app opens the diff of ${path}.`)}
      onOpenPage={(to) => note(`The app opens ${to}.`)}
      onWorkspaceChange={setWorkspace}
      orgId={backend.target.orgId}
      subscribe={backend.stream.subscribe}
      viewport={options.viewport}
      workspaceId={backend.target.workspaceId}
    />
  )
  const controls = <DevControls backend={backend} log={log} options={options} />
  const account = options.page === 'this-mac'
  const banner =
    options.app === 'mac' && !account ? (
      <DevMacBanner backend={backend} clock={props.clock} />
    ) : null
  const shown = account ? (
    <div className={styles.account}>
      <ThisMacSection
        client={backend.client}
        clock={props.clock}
        viewport={options.viewport}
      />
    </div>
  ) : (
    chat
  )
  if (mobile) {
    return (
      <div className={styles.mobileRoot}>
        <div className={styles.phone}>
          {banner}
          {account ? null : <DevHeader mobile workspace={workspace} />}
          {shown}
        </div>
        {controls}
      </div>
    )
  }
  return (
    <div className={styles.desktop}>
      {controls}
      <main className={styles.centre}>
        {banner}
        {account ? null : <DevHeader mobile={false} workspace={workspace} />}
        {shown}
      </main>
      <aside aria-label="Files and tools" className={styles.right} />
    </div>
  )
}
