import type { RunnerReportKind } from '../../src/shared/generated/RunnerReportKind'
import type { RunnerFileEvent } from '../../src/shared/generated/RunnerFileEvent'
import { storedReportGenerations } from '../files/report-generation'
import type { RunnerEventIdentity } from './runner-event-identity'
import type { IncomingRunnerEnvelope } from './runner-input'
import type { ChatTransaction } from './store'

function reportKind(
  type: RunnerEventIdentity['type'],
): RunnerReportKind | null {
  switch (type) {
    case 'files.changed':
      return 'files.snapshot'
    case 'files.snapshot':
    case 'changes.updated':
    case 'start.updated':
    case 'workspace.title':
    case 'ports.updated':
      return type
    default:
      return null
  }
}

export async function refuseReportRepair(
  transaction: ChatTransaction,
  message: Pick<IncomingRunnerEnvelope, 'streamId' | 'eventNumber'>,
  identity: RunnerEventIdentity,
  randomId: () => string,
): Promise<boolean> {
  const kind = reportKind(identity.type)
  if (!kind) return false
  const repair = await transaction.repairs.get(kind)
  const fileKind = kind === 'files.snapshot' || kind === 'changes.updated'
  const revision = fileKind ? identity.revision : null
  if (!repair) {
    const generations = fileKind
      ? await storedReportGenerations(transaction.files, kind)
      : null
    await transaction.repairs.save({
      command: { type: 'report.refresh', commandId: randomId(), kind },
      cause: {
        streamId: message.streamId,
        eventNumber: message.eventNumber,
        revision: generations
          ? Math.max(generations.latest, revision ?? 0)
          : null,
      },
      state: 'pending',
      sent: false,
      replacementRevision: null,
    })
    return false
  }
  if (fileKind) {
    if (identity.type !== kind) return false
    const currentReplacement = repair.replacementRevision === revision
    const oldTail =
      revision !== null &&
      identity.partNumber !== null &&
      identity.partNumber > 1 &&
      message.streamId === repair.cause.streamId &&
      revision <= (repair.cause.revision ?? 0) &&
      !currentReplacement
    if (oldTail) return false
  }
  repair.state = 'failed'
  await transaction.repairs.save(repair)
  return true
}

/** Accepted part one starts a replacement, even at a refused unapplied revision. */
export async function observeRepairPart(
  transaction: ChatTransaction,
  streamId: string,
  event: RunnerFileEvent,
): Promise<void> {
  if (event.type === 'files.changed' || event.type === 'files.unavailable')
    return
  const part = event.type === 'files.snapshot' ? event.tree : event.changes
  if (part.partNumber !== 1 || part.partCount === 1) return
  const repair = await transaction.repairs.get(event.type)
  if (!repair || repair.cause.streamId !== streamId) return
  const generations = await storedReportGenerations(
    transaction.files,
    event.type,
  )
  if (
    generations.pending !== part.revision ||
    repair.replacementRevision === part.revision
  )
    return
  repair.replacementRevision = part.revision
  await transaction.repairs.save(repair)
}
