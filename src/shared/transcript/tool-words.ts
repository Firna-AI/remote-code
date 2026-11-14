import type { ToolCall } from '../generated/ToolCall'
const verbs: Readonly<
  Record<ToolCall['kind'], { done: string; running: string }>
> = {
  read: { done: 'Read', running: 'Reading' },
  search: { done: 'Searched', running: 'Searching' },
  create: { done: 'Created', running: 'Creating' },
  edit: { done: 'Edited', running: 'Editing' },
  run: { done: 'Ran', running: 'Running' },
  computer: { done: 'Used', running: 'Using' },
  other: { done: 'Used', running: 'Using' },
}

const endings: Readonly<Partial<Record<ToolCall['state'], string>>> = {
  stopped: 'Stopped',
  failed: 'Failed',
}

export function toolVerb(call: ToolCall): string {
  const words = verbs[call.kind]
  return call.state === 'running' ? words.running : words.done
}

export function toolEnding(call: ToolCall): string | undefined {
  return endings[call.state]
}

/** A run with a call in progress or not done starts open. */
export function toolRunOpen(calls: readonly ToolCall[]): boolean {
  return calls.some((call) => call.state !== 'done')
}

/** A count for the line of a fold, such as "1 tool call": none for zero. */
function counted(count: number, noun: string): string[] {
  return count === 0 ? [] : [`${count} ${noun}${count === 1 ? '' : 's'}`]
}

/** The counts of a fold, with no zero count. */
export function foldLabel(calls: number, messages = 0): string {
  return [...counted(calls, 'tool call'), ...counted(messages, 'message')].join(
    ', ',
  )
}
