import type { ToolCall } from '../generated/ToolCall'
import { toolRunOpen } from './tool-words'
import type { Transcript, TranscriptItem } from './transcript'
import { foldedWork, type WorkItem } from './turn-work'

/** A part that the chat adds among the items, such as a Mac command. */
export interface TranscriptInsert<Content> {
  key: string
  /** The ID of the item that the part follows, or null when it comes first. */
  after: string | null
  content: Content
}

/** A step of a work fold: an item of the work, or an insert that follows one. */
export type WorkStep<Content> =
  | { kind: 'item'; item: WorkItem }
  | { kind: 'insert'; insert: TranscriptInsert<Content> }

/** An item that the chat draws on its own: a tool call joins a run instead. */
export type SingleItem = Exclude<TranscriptItem, { kind: 'tool' }>

export type Entry<Content> =
  | { kind: 'item'; item: SingleItem }
  | {
      kind: 'tools'
      id: string
      calls: ToolCall[]
      /** The run shows its calls until the user folds it, as `groupEntries` says. */
      open: boolean
    }
  | { kind: 'insert'; insert: TranscriptInsert<Content> }
  | { kind: 'work'; id: string; steps: WorkStep<Content>[] }

/** The calls and the message count of a work fold. Inserts add no count. */
export function workSummary<Content>(steps: readonly WorkStep<Content>[]): {
  calls: ToolCall[]
  messages: number
} {
  const items = steps.flatMap((step) =>
    step.kind === 'item' ? [step.item] : [],
  )
  return {
    calls: items.flatMap((item) => (item.kind === 'tool' ? [item.tool] : [])),
    messages: items.filter((item) => item.kind === 'agent').length,
  }
}

/** The ID of the newest tool call of a turn, or null when it has none. */
function newestCall(transcript: Transcript, turnId: string): string | null {
  const call = transcript.items.findLast(
    (item) => item.kind === 'tool' && item.turnId === turnId,
  )
  return call?.id ?? null
}

/**
 * Groups the items of a transcript into the entries that the chat draws, and
 * puts each insert after its item. When a turn has ended, each run of the
 * work before an answer becomes one work fold, as `foldedWork` says. An
 * insert that follows a folded item joins its fold, and an insert never
 * starts one. Each other run of consecutive tool calls is one entry, so the
 * chat can fold it. An insert ends such a run. While a turn runs, only the
 * run that holds its newest tool call starts open, also after a message that
 * follows it, and each earlier run of the turn starts folded. Each other run
 * starts open while one of its calls is not done.
 */
export function groupEntries<Content>(
  transcript: Transcript,
  inserts: readonly TranscriptInsert<Content>[],
): Entry<Content>[] {
  const followed = new Set(
    inserts.flatMap((insert) => (insert.after === null ? [] : [insert.after])),
  )
  const runs = foldedWork(transcript, followed)
  const starts = new Set(runs.map((run) => run[0].id))
  const folded = new Map(runs.flat().map((item) => [item.id, item] as const))
  const running = transcript.turn?.turnId ?? null
  const newest = running === null ? null : newestCall(transcript, running)
  const insertsAfter = (id: string | null) =>
    inserts.filter((insert) => insert.after === id)
  const entries: Entry<Content>[] = insertsAfter(null).map((insert) => ({
    kind: 'insert',
    insert,
  }))
  for (const item of transcript.items) {
    const last = entries.at(-1)
    const work = folded.get(item.id)
    if (work) {
      const fold: Extract<Entry<Content>, { kind: 'work' }> = last?.kind ===
        'work' && !starts.has(item.id)
        ? last
        : { kind: 'work', id: `work:${item.id}`, steps: [] }
      if (fold !== last) entries.push(fold)
      fold.steps.push({ kind: 'item', item: work })
      for (const insert of insertsAfter(item.id)) {
        fold.steps.push({ kind: 'insert', insert })
      }
      continue
    }
    if (item.kind !== 'tool') {
      entries.push({ kind: 'item', item })
    } else {
      const run: Extract<Entry<Content>, { kind: 'tools' }> = last?.kind ===
      'tools'
        ? last
        : { kind: 'tools', id: item.id, calls: [], open: false }
      if (run !== last) entries.push(run)
      run.calls.push(item.tool)
      run.open =
        item.turnId === running ? item.id === newest : toolRunOpen(run.calls)
    }
    for (const insert of insertsAfter(item.id)) {
      entries.push({ kind: 'insert', insert })
    }
  }
  return entries
}
