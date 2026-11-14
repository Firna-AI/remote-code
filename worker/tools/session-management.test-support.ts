import type { Session } from '../../src/shared/generated/Session'
import { CLAUDE } from '../chat/harness.test-support'
import { OUTER_MACHINE_ORIGIN } from '../chat/integration/outer-runtime.test-support'
import {
  OTHER_WORKSPACE,
  OUTER_TOKEN,
} from '../chat/integration/outer-seed.test-support'
import { chatKey } from '../chat/storage-keys'
import type { AgentWriteFixture } from '../features/agent-session-writes.test-support'

export function machineRead(active: AgentWriteFixture, path: string) {
  return active.runtime.dispatchFetch(`${OUTER_MACHINE_ORIGIN}${path}`, {
    headers: { Authorization: `Bearer ${OUTER_TOKEN}` },
  })
}

export async function seedOrderedSessions(active: AgentWriteFixture) {
  const session: Session = {
    id: 'z-session',
    workspaceId: OTHER_WORKSPACE,
    title: 'First',
    choice: CLAUDE,
    startedBy: {
      id: 'member',
      githubLogin: 'member',
      displayName: null,
      avatarUrl: null,
    },
    createdAt: 10,
    closedAt: null,
    activeTurnId: null,
    activeTurnStartedAt: null,
    retryMessageId: null,
    sourceSessionId: null,
    loginAvailable: true,
    loginShared: true,
  }
  await (
    await active.actor(OTHER_WORKSPACE)
  ).seedFeatureState({
    [chatKey('session', 'z-session')]: session,
    [chatKey('session', 'a-session')]: {
      ...session,
      id: 'a-session',
      title: 'Second',
      createdAt: 20,
    },
    [chatKey('session', 'closed-session')]: {
      ...session,
      id: 'closed-session',
      title: 'Closed',
      createdAt: 10,
      closedAt: 30,
    },
  })
}
