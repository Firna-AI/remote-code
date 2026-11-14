import type { Session } from '../../src/shared/generated/Session'
import type { Attachment } from '../../src/shared/generated/Attachment'

import { sessionTitleFrom } from '../../src/shared/session-title'
import type { ChatTransaction } from './store'
import type { ChatDependencies } from './types'

async function fillSessionTitle(
  session: Session,
  title: string | null,
  writable: () => Promise<boolean>,
): Promise<boolean> {
  if (session.title !== null || title === null || !(await writable()))
    return false
  session.title = title
  return true
}

export async function applyMessageSessionTitle(
  transaction: ChatTransaction,
  session: Session,
  text: string,
  attachments: readonly Attachment[],
  readWorkspace: ChatDependencies['readAutomaticTitleWorkspace'],
): Promise<void> {
  await fillSessionTitle(
    session,
    sessionTitleFrom(text, attachments),
    async () =>
      (await transaction.firstSession())?.id !== session.id &&
      (await readWorkspace(transaction.workspaceId)) !== null,
  )
}

export async function applyWorkspaceSessionTitle(
  transaction: ChatTransaction,
  title: string,
  occurredAt: number,
): Promise<void> {
  const first = await transaction.firstSession()
  if (!first) return
  const session = await transaction.session(first.id)
  if (!session || !(await fillSessionTitle(session, title, async () => true)))
    return
  await transaction.saveSession(session)
  await transaction.emit({ type: 'session.updated', session }, occurredAt)
}
