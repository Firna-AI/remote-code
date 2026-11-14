import type { Session } from '../shared/generated/Session'
import type { Workspace } from '../shared/generated/Workspace'
import type { BranchChangedFile } from '../shared/generated/BranchChangedFile'
import type { ChangesResponse } from '../shared/generated/ChangesResponse'
import type { MessageSender } from '../shared/generated/MessageSender'
import { continuedBranch } from '../../docs/mockups/src/fixtures/barActions'
import type { WorkspaceEvent } from '../shared/events'
import { filePaths } from '../shared/files'
import { githubPaths, type GitHubMergeMethod } from '../shared/github'

import { workspacePaths } from '../shared/workspaces'
import type { FakeApiServer } from './fake-api'
import { FAKE_IDS, FAKE_TIME } from './fixtures/core'
import { FAKE_FILE_PATH, toolFixtures } from './fixtures/tools'
import { nextEnvelope } from './recorded-repairs'

/*
 * The replies and events of the actions of the pull request bar, for tests
 * and the development pages. Each one follows the contracts of the Worker.
 */

const org = FAKE_IDS.org
const id = FAKE_IDS.workspace

/** The branch of the fake workspace after Continue, by the create rule. */
export const CONTINUED_BRANCH = continuedBranch

/** The Continue job of the fake workspace. */
export const CONTINUE_ID = `continue-${id}`

/** The member's access: write or more, read only, or a read that fails. */
export type FakeAccess = 'write' | 'read' | 'unknown'

/** How a merge of the fake ends. */
export type FakeMergeEnd =
  'merged' | 'moved-head' | 'no-right' | 'refused' | 'unavailable'

/**
 * The local work of the fake sandbox. `restored` is a file that an edit took
 * back to its base content: Git status holds it, and the net list does not.
 * `legacy` is a report of an older runner, with no count.
 */
export type FakeWork = 'none' | 'files' | 'restored' | 'commits' | 'legacy'

/** How a Continue of the fake ends. */
export type FakeContinueEnd =
  'continued' | 'question' | 'clash' | 'stopped' | 'turn'

function refusal(code: string, message: string) {
  return { error: { code, message } }
}

export function serveAccess(
  server: FakeApiServer,
  access: FakeAccess,
  method: GitHubMergeMethod | null = 'squash',
): void {
  const path = githubPaths.capabilities(org, id)
  if (access === 'unknown') {
    const body = refusal('github_unavailable', 'GitHub did not answer.')
    server.json('GET', path, body, 502)
    return
  }
  const canWrite = access === 'write'
  server.json('GET', path, { canWrite, mergeMethod: canWrite ? method : null })
}

/** The replies of a merge start and its poll, with the Worker's safe words. */
export function serveMerge(server: FakeApiServer, end: FakeMergeEnd): void {
  const start = githubPaths.merge(org, id)
  const pending = { state: 'pending', mergeId: `merge-${id}` }
  const poll = githubPaths.mergeResult(org, id, `merge-${id}`)
  switch (end) {
    case 'merged':
      server.json('POST', start, pending, 202)
      server.json('GET', poll, { state: 'merged' })
      return
    case 'moved-head':
      server.json(
        'POST',
        start,
        refusal(
          'github_head_changed',
          'Not merged: the branch has new commits. Review them, then merge again.',
        ),
        409,
      )
      return
    case 'no-right':
      server.json(
        'POST',
        start,
        refusal(
          'github_merge_forbidden',
          "Not merged: your GitHub access doesn't allow merges into this branch.",
        ),
        403,
      )
      return
    case 'refused':
      server.json(
        'POST',
        start,
        refusal('github_merge_refused', 'GitHub refused the merge.'),
        409,
      )
      return
    case 'unavailable':
      server.json('POST', start, pending, 202)
      server.json(
        'GET',
        poll,
        refusal(
          'github_merge_unavailable',
          'The merge result is not available. Open the pull request on GitHub.',
        ),
        404,
      )
  }
}

/** The changes report of the fake sandbox with this local work. */
export function workReport(work: FakeWork): ChangesResponse {
  const { changes } = toolFixtures()
  const files = changes.files.map((file) => ({
    ...file,
    uncommitted: work === 'files' && file.path === FAKE_FILE_PATH,
  }))
  // An older runner sends no count of commits or of files.
  if (work === 'legacy') {
    return { baseBranch: changes.baseBranch, files, summary: changes.summary }
  }
  // The current runner sends both counts. Its raw count holds each file in
  // Git status, also one that the net list leaves out.
  if (work === 'restored') {
    return {
      baseBranch: changes.baseBranch,
      unpushedCommits: 0,
      uncommittedFileCount: 1,
      files: [],
      summary: { files: 0, added: 0, removed: 0 },
    }
  }
  return {
    ...changes,
    files,
    unpushedCommits: work === 'commits' ? 2 : 0,
    uncommittedFileCount: work === 'files' ? 1 : 0,
  }
}

/**
 * The local work of the fake sandbox: the reply of the changes route, and a
 * newer full report in the stream, after the reports that it recorded.
 */
export function serveWork(server: FakeApiServer, work: FakeWork): void {
  const changes = workReport(work)
  server.json('GET', filePaths.changes(org, id), changes)
  const event: WorkspaceEvent = { type: 'changes.updated', changes }
  server.events.emit(nextEnvelope(server.events, event, FAKE_TIME))
}

/** The question of Continue: the local work on every local branch. */
export const continueQuestionReply = {
  state: 'confirmation-required',
  branch: toolFixtures().banner.banner.branch,
  baseBranch: 'main',
  localWork: { uncommittedFiles: [FAKE_FILE_PATH], unpushedCommits: 2 },
} as const

/**
 * The replies of a Continue start and its poll. A `continued` poll needs
 * the event number of the published events, so `continuedReply` gives it.
 */
export function serveContinue(
  server: FakeApiServer,
  end: FakeContinueEnd,
): void {
  const start = workspacePaths.continue(org, id)
  const poll = workspacePaths.continueResult(org, id, CONTINUE_ID)
  if (end === 'turn') {
    const body = refusal('workspace_turn_running', 'Wait for the turn to end.')
    server.json('POST', start, body, 409)
    return
  }
  server.json('POST', start, { state: 'pending', continueId: CONTINUE_ID }, 202)
  const branch = continueQuestionReply.branch
  if (end === 'question') server.json('GET', poll, continueQuestionReply)
  if (end === 'clash' || end === 'stopped') {
    const message =
      end === 'clash'
        ? `Continue stopped: the changed files clash with the latest main. The workspace stays on ${branch}.`
        : 'Continue could not finish. Check GitHub access and try again.'
    server.json('GET', poll, refusal('workspace_continue_failed', message), 409)
  }
}

/** Sets the `continued` reply of the poll, at the event number of its events. */
export function continuedReply(
  server: FakeApiServer,
  workspace: Workspace,
  eventNumber: number,
): void {
  const poll = workspacePaths.continueResult(org, id, CONTINUE_ID)
  server.json('GET', poll, { state: 'continued', workspace, eventNumber })
}

/**
 * The changes report of the new branch after Continue: only the changed
 * files that moved with it, none of them committed, and no commit of its
 * own yet.
 */
function continuedReport(moved: readonly BranchChangedFile[]): ChangesResponse {
  return {
    baseBranch: 'main',
    unpushedCommits: 0,
    uncommittedFileCount: moved.length,
    files: moved,
    summary: {
      files: moved.length,
      added: moved.reduce((sum, file) => sum + file.added, 0),
      removed: moved.reduce((sum, file) => sum + file.removed, 0),
    },
  }
}

/**
 * The events of a Continue, as the Worker and the runner publish them: the
 * workspace on its new branch and one note for each session, in one chat
 * transaction, the changes report of the new branch with the files that
 * moved, and then the GitHub state of the new branch, which has no commit
 * on GitHub yet.
 */
export function continuedEvents(
  workspace: Workspace,
  sessions: readonly Session[],
  member: MessageSender,
  moved: readonly BranchChangedFile[] = [],
): WorkspaceEvent[] {
  const record = { ...workspace, branch: CONTINUED_BRANCH, github: null }
  return [
    { type: 'workspace.updated', workspace: record },
    ...sessions.map((session): WorkspaceEvent => ({
      type: 'workspace.continued',
      sessionId: session.id,
      member,
      branch: CONTINUED_BRANCH,
      baseBranch: 'main',
    })),
    { type: 'changes.updated', changes: continuedReport(moved) },
    {
      type: 'github.updated',
      banner: {
        branch: CONTINUED_BRANCH,
        baseBranch: 'main',
        updatedAt: FAKE_TIME,
        state: 'no-commits',
        pullRequest: null,
      },
      checks: { state: 'waiting-for-pull-request', checks: [] },
    },
  ]
}
