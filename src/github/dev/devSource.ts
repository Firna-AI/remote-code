import type { MessageSender } from '../../shared/generated/MessageSender'
import { browserDelay } from '../../app/events'
import { githubPaths, type BannerState } from '../../shared/github'
import { FakeApiServer } from '../../test-support/fake-api'
import { scenarioFetch } from '../../test-support/fake-bar-dev'
import { FAKE_IDS, FAKE_TIME } from '../../test-support/fixtures/core'
import type { FetchLike } from '../githubClient'
import type { GitHubSource } from '../githubSource'
import type { DevOptions } from './devOptions'
import { sampleReplies } from './devSamples'

/**
 * How the fake GitHub answers. `normal` answers at once. `slow` waits two
 * seconds before each reply. `stored` waits two seconds only for the
 * GitHub reads, and gives the stored state of the sample at once, as after
 * an earlier read. `error` fails the banner read.
 */
export type GitHubMode = 'normal' | 'slow' | 'stored' | 'error'

export interface DevSource extends GitHubSource {
  /** The fake API, for the chat, the files, and the stream of the page. */
  server: FakeApiServer
  /** Sends a live `github.updated` event with the sample data of a state. */
  emit: (state: BannerState) => void
  /** Makes the next load succeed, so that Try again recovers. */
  recover: () => void
}

const bannerPath = githubPaths.banner(FAKE_IDS.org, FAKE_IDS.workspace)
const checksPath = githubPaths.checks(FAKE_IDS.org, FAKE_IDS.workspace)
const storedPath = githubPaths.stored(FAKE_IDS.org, FAKE_IDS.workspace)

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * The fake API of one banner state, sample, and set of answers, as the
 * development page uses it. The replies and the live events of a sample
 * carry the same data. The actions of the bar get the answers of
 * `options.scenario`, as `scenarioFetch` gives them.
 */
export function createDevSource(
  options: Pick<
    DevOptions,
    'state' | 'github' | 'sample' | 'turn' | 'scenario'
  >,
  member: MessageSender,
): DevSource {
  const { state, github: mode, sample } = options
  const server = new FakeApiServer({
    banner: state,
    ...(options.turn === 'running' ? { conversation: 'running' } : {}),
  })
  const actions = scenarioFetch(
    server,
    options.scenario,
    member,
    () => FAKE_TIME,
  )
  let replies = sampleReplies(sample, state)
  let failing = mode === 'error'
  if (sample !== 'fake') {
    server.json('GET', bannerPath, replies.banner)
    server.json('GET', checksPath, replies.checks)
  }
  if (mode === 'stored') {
    const { banner } = replies.banner
    server.json('GET', storedPath, {
      state: { banner, checks: replies.checks },
    })
  }
  if (failing) {
    const error = {
      code: 'github_unavailable',
      message: 'GitHub did not answer. Try again in a moment.',
    }
    server.json('GET', bannerPath, { error }, 503)
  }
  const fetch: FetchLike = async (input, init) => {
    const stored = new URL(input, 'http://dev.test').pathname === storedPath
    if (mode === 'slow' || (mode === 'stored' && !stored)) await wait(2_000)
    return actions(input, init)
  }
  return {
    server,
    fetch,
    subscribe: (after, listener) => server.events.subscribe(after, listener),
    delay: browserDelay,
    emit: (next) => {
      // The actions of the bar add events too, so each one counts.
      const last = server.events.history(Number.MAX_SAFE_INTEGER)
      const eventNumber = last.throughEventNumber + 1
      const data = sampleReplies(sample, next)
      replies = data
      if (!failing) server.json('GET', bannerPath, data.banner)
      server.json('GET', checksPath, data.checks)
      server.events.emit({
        workspaceId: FAKE_IDS.workspace,
        eventNumber,
        occurredAt: FAKE_TIME,
        event: {
          type: 'github.updated',
          banner: data.banner.banner,
          checks: data.checks,
        },
      })
    },
    recover: () => {
      failing = false
      server.json('GET', bannerPath, replies.banner)
      server.json('GET', checksPath, replies.checks)
    },
  }
}
