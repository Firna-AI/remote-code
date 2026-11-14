/**
 * The words of the end reason of a finished turn: a cause, other than the
 * end of the agent's reply, that ended the turn. The turn still finished,
 * so it keeps its duration and its files, and one line names the cause.
 * The words name what stopped, not the number of the limit, because the
 * member cannot change it.
 */

import type { TurnEndReason } from '../../../../../src/shared/generated/TurnEndReason'
const reasons: Readonly<Record<TurnEndReason, string>> = {
  background_work_limit: 'Background work stopped at the time limit',
}

/**
 * The line of an end reason, such as "Background work stopped at the time
 * limit".
 */
export function endReasonText(reason: TurnEndReason): string {
  return reasons[reason]
}
