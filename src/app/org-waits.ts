import type { Workspace } from '../shared/generated/Workspace'
import type { WorkspaceState } from '../shared/generated/WorkspaceState'
import type { BuildsResponse } from '../shared/org-settings'
import type { RoutineRun } from '../shared/routines'

import type { ListedRoutine } from './api/read-routines'
import type { ListData } from './list-changes'
import type { RefreshWait } from './refresh'

/**
 * How soon a shown part of an org reads again. These are choices of the
 * app, not product limits: soon while a workspace, a routine run, or a
 * build is active, or while the checks of a pull request run, and slowly
 * otherwise, so that changes from other tabs, people, and GitHub show.
 */
const activeWait = 5_000
const idleWait = 30_000
const activeStates: ReadonlySet<WorkspaceState> = new Set([
  'working',
  'input',
  'starting',
])

/**
 * Whether a workspace makes its list read soon: its agent works or waits,
 * its cloud computer starts, or the checks of its pull request run, so the
 * colour of its mark changes soon.
 */
function readsSoon(workspace: Workspace): boolean {
  return (
    activeStates.has(workspace.state) || workspace.github === 'checks-running'
  )
}

/**
 * The wait of a shown workspace list: short while one of its workspaces is
 * active or its checks run. A chat that reads the list itself uses it too.
 */
export const workspacesWait: RefreshWait<readonly Workspace[]> = (
  workspaces,
) => (workspaces?.some(readsSoon) ? activeWait : idleWait)

/** A run that waits for its workspace counts as active, as a start does. */
const activeRunStates: ReadonlySet<RoutineRun['state']> = new Set([
  'queued',
  ...activeStates,
])

export const routinesWait: RefreshWait<readonly ListedRoutine[]> = (
  routines,
) =>
  routines?.some(
    (routine) => routine.lastRun && activeRunStates.has(routine.lastRun.state),
  )
    ? activeWait
    : idleWait

export const listWait: RefreshWait<ListData> = (list) =>
  workspacesWait(list?.workspaces)

export const buildsWait: RefreshWait<BuildsResponse> = (builds) =>
  builds?.builds.some((build) => build.state === 'running')
    ? activeWait
    : idleWait

/** Repositories and members read at entry and focus only. */
export const onEntry: RefreshWait<unknown> = () => null
