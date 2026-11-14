import type { AgentModel } from '../../shared/generated/AgentModel'
import type { ReactNode } from 'react'
import { ArrowRight, CircleAlert, FolderGit2, Hammer, Plug } from 'lucide-react'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import { Notice } from '../../../docs/mockups/src/components/common/Notice'
import { firstBuildCopy as buildCopy } from '../../../docs/mockups/src/screens/firstBuildCopy'
import type { ApiError } from '../../app/api/client'
import { loginUsable } from '../../app/api/read-core'
import { firstBuildOf } from '../../app/first-build'
import { mayChangeSettings } from '../../app/permissions'
import type { CreateState } from '../../app/new-workspace-model'
import { routes } from '../../app/router'
import { useStore, valueOf } from '../../app/store'
import { formatElapsed, useNow } from '../../app/time'
import { modelLabel } from '../../shared/agents'
import type { ImageBuild } from '../../shared/org-settings'
import type { OrgSummary } from '../../shared/orgs'
import { useApp, useOrgAccess, useOrgModel } from '../context'
import { ActionButton } from '../ui/actions'

const agentNames = { claude: 'Claude', codex: 'Codex' } as const

/**
 * The notice of the build that runs, with its time, which moves on. Its
 * `action` is the link of an admin to the Cloud computer tab.
 */
function RunningBuild(props: { build: ImageBuild; action?: ReactNode }) {
  const now = useNow(1_000)
  // A narrow phone keeps the time on one line.
  const elapsed = formatElapsed(now - props.build.startedAt).replaceAll(
    ' ',
    '\u00a0',
  )
  return (
    <Notice
      action={props.action}
      body={buildCopy.running.body}
      busy
      icon={Hammer}
      title={buildCopy.running.title(elapsed)}
    />
  )
}

/**
 * The notice over the composer while the org has no good image: its first
 * build runs, failed, or never started. A notice turns Send off, so no
 * create fails for want of an image. Only an admin builds and sets up the
 * computer, so only an admin gets the link to the Cloud computer tab, in
 * each state, and a member reads who can act. Once a build succeeded, no
 * notice shows, also during a later build. None shows while the builds
 * load.
 */
export function useFirstBuildNotice(
  org: OrgSummary,
  openPage: (to: string) => void,
): ReactNode {
  const builds = valueOf(useStore(useOrgModel(org.id).builds))
  const admin = mayChangeSettings(useOrgAccess(org))
  if (!builds) return null
  const first = firstBuildOf(builds)
  const open = admin ? (
    <ActionButton
      icon={ArrowRight}
      onPress={() => openPage(routes.settings(org.id, 'cloud-computer'))}
    >
      {buildCopy.settings}
    </ActionButton>
  ) : undefined
  switch (first.state) {
    case 'succeeded':
      return null
    case 'running':
      return <RunningBuild action={open} build={first.build} />
    case 'failed':
      return (
        <Notice
          action={open}
          body={admin ? buildCopy.failed.admin : buildCopy.failed.member}
          icon={CircleAlert}
          title={buildCopy.failed.title}
          tone="danger"
        />
      )
    case 'none':
      return (
        <Notice
          action={open}
          body={admin ? buildCopy.none.admin : buildCopy.none.member}
          icon={Hammer}
          title={buildCopy.none.title}
        />
      )
  }
}

/**
 * The notice over the composer when a message cannot go yet: the agent of
 * the chosen model has no login that can run turns. A login that the app
 * can no longer use counts as none. A notice turns Send off. Its Connect
 * goes to the account through `open`, where the form of the agent opens.
 */
export function useBlockingNotice(
  choice: AgentChoice | undefined,
  models: readonly AgentModel[],
  open: (to: string) => void,
): ReactNode {
  const app = useApp()
  const account = useStore(app.account.account)
  const login = account?.agentLogins.find(
    (item) => item.agent === choice?.agent,
  )
  if (choice && account && !loginUsable(login)) {
    const agent = agentNames[choice.agent]
    return (
      <Notice
        action={
          <ActionButton
            icon={Plug}
            onPress={() => open(routes.account(choice.agent))}
          >
            {`Connect ${agent}`}
          </ActionButton>
        }
        icon={Plug}
        title={`Connect ${agent} to use ${modelLabel(models, choice)}`}
      />
    )
  }
  return null
}

/**
 * What an org without chosen repositories asks first, without the full
 * stop. An admin chooses them. A member who is not an admin reads that an
 * admin chooses them, because only an admin can.
 */
export function repositoriesFirst(org: Pick<OrgSummary, 'name' | 'role'>) {
  return org.role === 'admin'
    ? `Choose the repositories of ${org.name} first`
    : `An admin of ${org.name} chooses its repositories first`
}

/**
 * The notice of an org that has chosen no repositories yet, so no workspace
 * can start. An admin gets Choose repositories, which goes to the
 * Repositories tab of the org settings through `open`.
 */
export function ChooseRepositoriesNotice(props: {
  org: OrgSummary
  open: (to: string) => void
}) {
  const { org } = props
  return (
    <Notice
      action={
        org.role === 'admin' ? (
          <ActionButton
            icon={FolderGit2}
            onPress={() => props.open(routes.settings(org.id, 'repositories'))}
          >
            Choose repositories
          </ActionButton>
        ) : undefined
      }
      icon={FolderGit2}
      title={repositoriesFirst(org)}
    />
  )
}

/**
 * The code of a start that failed before the server took the message. Its
 * message is the one that the Worker saved for the start, such as its time
 * limit.
 */
const startFailed = 'workspace_start_failed'

const notStarted = "Its sandbox didn't start. Your message is kept."

/**
 * The text of a create request that failed, by its status and code. The
 * form keeps the message, and Try again sends it with the same ID.
 */
function failureBody(error: ApiError): string {
  if (error.status === 0) {
    return "The app can't reach the server. Your message is kept."
  }
  if (error.code === startFailed)
    return `${error.message} Your message is kept.`
  if (error.status >= 500) return notStarted
  return `${error.message} Your message is kept.`
}

/**
 * A create request that failed. The draft stays, and Try again sends it
 * again. Try again is off while the message cannot go, as Send is. A start
 * that failed before the server took the message shows the message that
 * the Worker saved for it.
 */
function CreateFailed(props: {
  error: ApiError
  ready: boolean
  retry: () => void
}) {
  return (
    <Notice
      action={
        <ActionButton
          disabled={!props.ready}
          onPress={props.retry}
          tone="primary"
        >
          Try again
        </ActionButton>
      }
      body={failureBody(props.error)}
      icon={CircleAlert}
      title="The workspace wasn't created"
      tone="danger"
    />
  )
}

/** The notice of a create that failed, or `null` while none failed. */
export function createFailure(
  create: CreateState,
  ready: boolean,
  retry: () => void,
): ReactNode {
  if (create.state !== 'failed') return null
  return <CreateFailed error={create.error} ready={ready} retry={retry} />
}
