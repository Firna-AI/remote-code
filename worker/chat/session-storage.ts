import type { Session } from '../../src/shared/generated/Session'

type OptionalSessionFields =
  | 'startedBy'
  | 'sourceSessionId'
  | 'loginAvailable'
  | 'loginShared'
  | 'retryMessageId'
  | 'activeTurnStartedAt'
export type StoredSession = Omit<Session, OptionalSessionFields> &
  Partial<Pick<Session, OptionalSessionFields>>

export function normalizeSession(session: StoredSession): Session {
  return {
    ...session,
    choice: { ...session.choice, fast: session.choice.fast ?? false },
    activeTurnStartedAt: session.activeTurnId
      ? (session.activeTurnStartedAt ?? null)
      : null,
    retryMessageId: session.retryMessageId ?? null,
    startedBy: session.startedBy ?? null,
    sourceSessionId: session.startedBy
      ? (session.sourceSessionId ?? null)
      : null,
    loginAvailable: session.startedBy
      ? (session.loginAvailable ?? false)
      : false,
    loginShared: session.loginShared ?? true,
  }
}
