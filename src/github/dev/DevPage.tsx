import { useCallback, useEffect, useMemo, useState } from 'react'
import { domBackendCss } from '@firna/ui'
import { SharedUiThemeProvider } from '@firna/ui/theme'
import type { MessageSender } from '../../shared/generated/MessageSender'
import { themeFor, tokensCss } from '../../../docs/mockups/src/theme'
import { mayArchive } from '../../app/permissions'
import type { OrgRole } from '../../shared/api'
import {
  FAKE_IDS,
  FAKE_TIME,
  fakeUsers,
} from '../../test-support/fixtures/core'
import {
  senderSnapshot,
  workspaceFixtures,
} from '../../test-support/fixtures/workspaces'
import { ChecksActions } from '../BarButtons'
import { ChecksList } from '../ChecksList'
import { PullRequestBar } from '../PullRequestBar'
import { PullRequestRow } from '../PullRequestRow'
import { useGitHubState } from '../useGitHubState'
import { useDevBar } from './devBar'
import { DevControls } from './DevControls'
import { optionsQuery, readOptions, type DevOptions } from './devOptions'
import { DevReadout } from './DevReadout'
import { createDevSource, type DevSource } from './devSource'
import styles from './DevPage.module.css'

const target = { orgId: FAKE_IDS.org, workspaceId: FAKE_IDS.workspace }
const workspace = workspaceFixtures().detail.workspace

/** Each viewer of the page: the member and the role of that member. */
const viewers: Readonly<
  Record<DevOptions['viewer'], { member: MessageSender; role: OrgRole }>
> = {
  owner: { member: workspace.owner, role: 'member' },
  admin: { member: senderSnapshot(fakeUsers[1]), role: 'admin' },
  member: { member: senderSnapshot(fakeUsers[2]), role: 'member' },
}

/**
 * The desktop right column and the phone, both against the fake API, with
 * the real action state of the bar.
 */
function Preview(props: {
  source: DevSource
  viewer: DevOptions['viewer']
  onNote: (note: string) => void
}) {
  const { source, onNote } = props
  const { fetch, subscribe, delay } = source
  const github = useGitHubState(target, { fetch, subscribe, delay })
  const { member, role } = viewers[props.viewer]
  const archivable = mayArchive({ role, suspended: false }, workspace, member)
  const archive = useMemo(
    () =>
      archivable ? () => onNote('Archive opens the app’s Archive flow.') : null,
    [archivable, onNote],
  )
  const showChat = useCallback(
    () => onNote('The app shows the chat, whose composer names the cause.'),
    [onNote],
  )
  const { controls, actions, chat } = useDevBar({
    source,
    target,
    github,
    branch: workspace.branch,
    archive,
    showChat,
  })
  return (
    <div className={styles.frames}>
      <section aria-label="Desktop right column">
        <p className={styles.frameLabel}>Desktop right column</p>
        <div className={styles.column}>
          <PullRequestBar controls={controls} github={github} now={FAKE_TIME} />
          <div className={styles.tabs}>
            <span className={styles.tab}>Checks</span>
          </div>
          <ChecksList github={github} />
        </div>
      </section>
      <section aria-label="Phone">
        <p className={styles.frameLabel}>Phone</p>
        <div className={styles.phone}>
          <PullRequestRow
            checksHref="#phone-checks"
            controls={controls}
            github={github}
          />
          <div className={styles.phoneChecks} id="phone-checks">
            <ChecksActions controls={controls} />
            <ChecksList github={github} />
          </div>
        </div>
      </section>
      <DevReadout actions={actions} chat={chat} />
    </div>
  )
}

/**
 * The development page of the GitHub banner. It serves at
 * /src/github/dev/index.html with `npm run dev`, and no app route mounts it.
 */
export function DevPage() {
  const [options, setOptions] = useState(() => readOptions(location.search))
  const [note, setNote] = useState('')
  const member = viewers[options.viewer].member
  const { state, github, sample, turn, scenario } = options
  const source = useMemo(
    () => createDevSource({ state, github, sample, turn, scenario }, member),
    [state, github, sample, turn, scenario, member],
  )
  useEffect(() => {
    history.replaceState(null, '', optionsQuery(options))
  }, [options])
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: domBackendCss }} />
      <style dangerouslySetInnerHTML={{ __html: tokensCss(options.scheme) }} />
      <SharedUiThemeProvider theme={themeFor(options.scheme)}>
        <main className={styles.page}>
          <DevControls
            note={note}
            onChange={(next) => {
              setNote('')
              setOptions(next)
            }}
            onEmit={(next) => {
              source.emit(next)
              setNote(`Sent a live event: ${next}`)
            }}
            onRecover={() => {
              source.recover()
              setNote('The next load succeeds. Press Try again.')
            }}
            options={options}
          />
          <Preview
            key={optionsQuery(options)}
            onNote={setNote}
            source={source}
            viewer={options.viewer}
          />
        </main>
      </SharedUiThemeProvider>
    </>
  )
}
