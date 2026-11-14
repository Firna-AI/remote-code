import type { MessageSender } from '../../shared/generated/MessageSender'
import {
  eventLabels,
  scheduleLabels,
} from '../../../docs/mockups/src/components/routines/triggerCopy'
import { personName } from '../../app/people'
import { routes } from '../../app/router'
import { API_PATHS } from '../../shared/api'
import type { RoutineRun, RoutineRunTrigger } from '../../shared/routines'
import { agentNames } from '../account/labels'

/** What started a run, such as "PR opened", "Daily", or "Run now". */
export function runTriggerLabel(trigger: RoutineRunTrigger): string {
  switch (trigger.kind) {
    case 'schedule':
      return scheduleLabels[trigger.schedule]
    case 'run-now':
      return 'Run now'
    case 'pull-request':
      return eventLabels[trigger.event]
  }
}

/** The code that a run stores when the cloud computer of its workspace did not start. */
const startFailed = 'workspace_start_failed'

/**
 * The state whose mark a run shows. A failed run keeps the mark of its
 * failure, also after Try again in its workspace, because the run keeps its
 * failed outcome. A run whose first start failed shows the cross of its
 * workspace in the error state. A failed check and a failed first turn show
 * the slash of a failed run: after a failed turn, the mark of the workspace
 * would show a finished turn.
 */
export function runMark(run: RoutineRun): RoutineRun['state'] {
  return run.state === 'failed' && run.error?.code === startFailed
    ? 'error'
    : run.state
}

/**
 * The one action that fixes the cause of a failed run: an address of the
 * app, or the sign-in of the Worker, which leaves the app.
 */
interface FixAction {
  label: string
  to: string
  leavesApp: boolean
}

export interface FailureCopy {
  text: string
  action: FixAction | null
}

/**
 * The words that the Worker stored with the failure of a run, with no
 * action. A run without them failed in its first turn.
 */
function storedCopy(run: RoutineRun): FailureCopy {
  return { text: run.error?.message || 'The first turn failed.', action: null }
}

/** "Your" for the owner of the run, and the name of the owner for anyone else. */
function whose(owner: MessageSender, own: boolean): string {
  return own ? 'Your' : `${personName(owner)}'s`
}

/**
 * The cause of a failed run in words, from the run alone: its stored error,
 * its agent, and its owner. So a later change of the agent of its routine,
 * or a move of the routine to another owner, changes no past row. The
 * owner of the run reads what to fix, with the one action that fixes it.
 * Another member reads whose login or access it is, because only that
 * owner can fix it. `viewer` is the ID of the person signed in, or null
 * where nobody can act, as in a suspended org.
 *
 * - A check of the agent login or of the GitHub access failed the run
 *   before it had a workspace.
 * - A first start that failed kept its workspace, whose Try again starts
 *   it again. Its words come from its stored code.
 * - A first turn that failed kept its workspace too, so its cause is the
 *   stored error of the turn. A first turn whose sender lost access, such
 *   as after the owner left the org, stores the code of a missing login
 *   with its own words.
 * - A run from before runs kept their agent and owner shows the stored
 *   words of a failed check, with no action.
 */
export function failureCopy(
  run: RoutineRun,
  viewer: string | null,
): FailureCopy {
  const code = run.error?.code
  if (code === startFailed) {
    return { text: "The cloud computer didn't start.", action: null }
  }
  const { agent, owner } = run
  if (agent === null || owner === null) return storedCopy(run)
  const own = owner.id === viewer
  if (code === 'agent_login_required' && run.workspaceId === null) {
    const name = agentNames[agent]
    return {
      text: `${whose(owner, own)} ${name} login isn't connected.`,
      action: own
        ? {
            label: `Connect ${name}`,
            to: routes.account(agent),
            leavesApp: false,
          }
        : null,
    }
  }
  if (code === 'github_reconnect_required') {
    return {
      text: `${whose(owner, own)} GitHub access expired.`,
      action: own
        ? {
            label: 'Sign in with GitHub',
            to: API_PATHS.githubSignIn,
            leavesApp: true,
          }
        : null,
    }
  }
  return storedCopy(run)
}

/** The verb of the account that caused each pull request event. */
const senderVerbs = {
  opened: 'Opened',
  pushed: 'Pushed',
  merged: 'Merged',
} as const

/**
 * Why a run was skipped. An account outside the org shows by its login, so
 * the owner knows which account to add to "Author is". The author opened
 * the pull request. The sender caused the event: it opened, pushed to, or
 * merged the pull request. A suspended org names the org. Each other
 * reason, and an older skip without a login, is the words of the API.
 */
export function skipCopy(run: RoutineRun, orgName: string): string {
  const code = run.error?.code
  if (code === 'org_suspended') return `${orgName} is suspended.`
  const { trigger } = run
  if (trigger.kind === 'pull-request' && trigger.skipLogin) {
    const outside = `@${trigger.skipLogin}, not a member of ${orgName}.`
    if (code === 'author_not_allowed') return `Opened by ${outside}`
    if (code === 'sender_not_allowed') {
      return `${senderVerbs[trigger.event]} by ${outside}`
    }
  }
  return run.error?.message || 'This run was skipped.'
}
