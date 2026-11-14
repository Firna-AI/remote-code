import { describe, expect, test } from 'vitest'
import type { MessageSender } from '../../shared/generated/MessageSender'
import type { RoutinePullRequestEvent, RoutineRun } from '../../shared/routines'
import { FAKE_TIME, fakeUser } from '../../test-support/fixtures/core'
import { pullRequestTrigger } from '../../test-support/fixtures/routine-runs'
import { failureCopy, skipCopy } from './run-copy'

/** Cal, who owns the review routine and signs in. */
const cal: MessageSender = {
  id: fakeUser.id,
  githubLogin: fakeUser.githubLogin,
  displayName: fakeUser.displayName,
  avatarUrl: fakeUser.avatarUrl,
}

/** Lena Park, who left the org, so her routine moved to Cal. Her user record stays. */
const lena: MessageSender = {
  id: 'lena',
  githubLogin: 'lenapark',
  displayName: 'Lena Park',
  avatarUrl: null,
}

/** The words of each skip, as the Worker stores them. */
const workerWords: Readonly<Record<string, string>> = {
  author_not_allowed:
    'The pull request author is outside the org and is not in Author is.',
  sender_not_allowed:
    'The event sender is outside the org and is not in Author is.',
  org_suspended: 'The org is suspended.',
  owner_left: 'The routine owner left the org.',
}

/** A skipped run of a pull request event, with the login that it names. */
function skipped(
  event: RoutinePullRequestEvent,
  code: string,
  login?: string,
): RoutineRun {
  return {
    id: 'run-1',
    routineId: 'review-prs',
    orgId: 'acme',
    agent: 'claude',
    owner: cal,
    trigger: pullRequestTrigger('storefront', event, 489, login),
    state: 'skipped',
    workspaceId: null,
    error: { code, message: workerWords[code] },
    createdAt: FAKE_TIME,
    updatedAt: FAKE_TIME,
  }
}

describe('the words of a skipped run', () => {
  test('name the author who opened the pull request, or the sender of the event', () => {
    const author = 'author_not_allowed'
    const sender = 'sender_not_allowed'
    expect({
      authorOfOpen: skipCopy(skipped('opened', author, 'rui-silva'), 'Acme'),
      authorOfPush: skipCopy(skipped('pushed', author, 'rui-silva'), 'Acme'),
      senderOfOpen: skipCopy(skipped('opened', sender, 'octo-bot'), 'Acme'),
      senderOfPush: skipCopy(
        skipped('pushed', sender, 'github-actions[bot]'),
        'Acme',
      ),
      senderOfMerge: skipCopy(skipped('merged', sender, 'octo-bot'), 'Acme'),
    }).toEqual({
      authorOfOpen: 'Opened by @rui-silva, not a member of Acme.',
      authorOfPush: 'Opened by @rui-silva, not a member of Acme.',
      senderOfOpen: 'Opened by @octo-bot, not a member of Acme.',
      senderOfPush: 'Pushed by @github-actions[bot], not a member of Acme.',
      senderOfMerge: 'Merged by @octo-bot, not a member of Acme.',
    })
  })

  test('name a suspended org, and keep the Worker words of an older skip and of each other reason', () => {
    expect({
      suspended: skipCopy(skipped('pushed', 'org_suspended'), 'Acme'),
      olderSkip: skipCopy(skipped('opened', 'author_not_allowed'), 'Acme'),
      ownerLeft: skipCopy(skipped('opened', 'owner_left'), 'Acme'),
      ownerLeftWithLogin: skipCopy(
        skipped('pushed', 'owner_left', 'rui-silva'),
        'Acme',
      ),
    }).toEqual({
      suspended: 'Acme is suspended.',
      olderSkip: workerWords.author_not_allowed,
      ownerLeft: workerWords.owner_left,
      ownerLeftWithLogin: workerWords.owner_left,
    })
  })
})

/** A failed run of a pull request event, with the facts that the Worker kept. */
function failed(
  facts: Pick<RoutineRun, 'agent' | 'owner' | 'workspaceId'>,
  code: string,
  message: string,
): RoutineRun {
  return {
    id: 'run-2',
    routineId: 'review-prs',
    orgId: 'acme',
    ...facts,
    trigger: pullRequestTrigger('storefront', 'opened', 488),
    state: 'failed',
    error: { code, message },
    createdAt: FAKE_TIME,
    updatedAt: FAKE_TIME,
  }
}

/** The words that the Worker stores for each cause of a failed check. */
const loginWords = 'Connect Claude to run this routine.'
const githubWords = 'GitHub access expired. Sign in with GitHub again.'

describe('the words of a failed run', () => {
  test('name the owner of the run after the routine moved to another owner, who gets no action', () => {
    const before = { agent: 'claude', owner: lena, workspaceId: null } as const
    expect({
      login: failureCopy(
        failed(before, 'agent_login_required', loginWords),
        cal.id,
      ),
      github: failureCopy(
        failed(before, 'github_reconnect_required', githubWords),
        cal.id,
      ),
    }).toEqual({
      login: {
        text: "Lena Park's Claude login isn't connected.",
        action: null,
      },
      github: { text: "Lena Park's GitHub access expired.", action: null },
    })
  })

  test('keep the stored words, with no action, of a first turn whose sender left and of a run from before runs kept their agent and owner', () => {
    const senderLeft =
      'The message sender no longer has access to this workspace.'
    expect({
      senderLeft: failureCopy(
        failed(
          { agent: 'claude', owner: cal, workspaceId: 'review-prs-opened-488' },
          'agent_login_required',
          senderLeft,
        ),
        cal.id,
      ),
      noAgent: failureCopy(
        failed(
          { agent: null, owner: cal, workspaceId: null },
          'agent_login_required',
          loginWords,
        ),
        cal.id,
      ),
      noOwner: failureCopy(
        failed(
          { agent: 'claude', owner: null, workspaceId: null },
          'github_reconnect_required',
          githubWords,
        ),
        cal.id,
      ),
    }).toEqual({
      senderLeft: { text: senderLeft, action: null },
      noAgent: { text: loginWords, action: null },
      noOwner: { text: githubWords, action: null },
    })
  })
})
