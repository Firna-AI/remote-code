import type { DeviceCommandRecord } from '../generated/DeviceCommandRecord'

import type { TranscriptItem } from './transcript'

/** A command and the item that it follows, or null when it comes first. */
export interface PlacedCommand {
  request: DeviceCommandRecord
  after: string | null
}

/** The turn of an item. A message, a lost line, and a note place no command. */
const turnOf = (item: TranscriptItem): string | null =>
  item.kind === 'user' || item.kind === 'lost' || item.kind === 'continued'
    ? null
    : item.turnId

const endsTurn = (item: TranscriptItem) =>
  item.kind === 'turn-end' || item.kind === 'stopped' || item.kind === 'failed'

/**
 * Places each answered command at its place in its turn: after the items
 * of the turn that began before the request, and before the end of the
 * turn. `times` gives the first time of each item. A command whose turn has
 * no item in the transcript follows the last item. Commands with the same
 * place keep the order of `requests`.
 */
export function placeCommands(
  items: readonly TranscriptItem[],
  times: ReadonlyMap<string, number>,
  requests: readonly DeviceCommandRecord[],
): PlacedCommand[] {
  return requests.map((request) => {
    let last: string | null = null
    for (const [index, item] of items.entries()) {
      if (turnOf(item) !== request.turnId) continue
      const later = (times.get(item.id) ?? -Infinity) > request.createdAt
      if (endsTurn(item) || later) {
        return { request, after: index > 0 ? items[index - 1].id : null }
      }
      last = item.id
    }
    return { request, after: last ?? items.at(-1)?.id ?? null }
  })
}
