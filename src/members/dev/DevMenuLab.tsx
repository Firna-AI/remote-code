import type { Workspace } from '../../shared/generated/Workspace'
import { useState } from 'react'

import type { MembersApi } from '../api/client'
import { OwnerPicker } from '../OwnerPicker'
import type { DevOptions } from './devOptions'
import { devWorkspace } from './devOrgs'
import host from './DevHost.module.css'
import styles from './DevMenuLab.module.css'

/**
 * A dev-only lab for the desktop owner menu: a page that scrolls, with the
 * owner button inside a short box that clips its content. `top` sets the
 * space above the box, so the menu can open below or above its button. Use
 * `people=40` for a long list of members.
 */
export function DevMenuLab(props: { api: MembersApi; options: DevOptions }) {
  const [workspace, setWorkspace] = useState<Workspace>(() =>
    devWorkspace('acme'),
  )
  return (
    <div className={styles.lab}>
      <div style={{ height: props.options.top }} />
      <div className={styles.clip}>
        <span className={host.note}>This box clips its content.</span>
        <OwnerPicker
          api={props.api}
          canReassign
          onReassigned={setWorkspace}
          viewport="desktop"
          workspace={workspace}
        />
      </div>
      <div className={styles.tail} />
    </div>
  )
}
