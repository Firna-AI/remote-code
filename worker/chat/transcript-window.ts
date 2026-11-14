import type { AgentReadSessionRequest } from '../../src/shared/generated/AgentReadSessionRequest'
import type { AgentTranscriptWindow } from '../../src/shared/generated/AgentTranscriptWindow'

interface Line {
  start: number
  end: number
  bytes: number
}

function character(text: string, at: number): { width: number; bytes: number } {
  const code = text.codePointAt(at) ?? 0
  const width = code > 0xffff ? 2 : 1
  if (code === 34 || code === 92) return { width, bytes: 2 }
  if (code < 32)
    return { width, bytes: [8, 9, 10, 12, 13].includes(code) ? 2 : 6 }
  if (code >= 0xd800 && code <= 0xdfff) return { width, bytes: 6 }
  return {
    width,
    bytes: code < 128 ? 1 : code < 2048 ? 2 : width === 1 ? 3 : 4,
  }
}

function linesOf(text: string): Line[] {
  const lines: Line[] = []
  let start = 0
  let bytes = 0
  for (let at = 0; at < text.length;) {
    const next = character(text, at)
    bytes += next.bytes
    at += next.width
    if (text[at - 1] === '\n') {
      lines.push({ start, end: at, bytes })
      start = at
      bytes = 0
    }
  }
  if (start < text.length || lines.length === 0)
    lines.push({ start, end: text.length, bytes })
  return lines
}

function previous(text: string, at: number): number {
  const code = text.charCodeAt(at - 1)
  const before = text.charCodeAt(at - 2)
  return (
    at -
    (code >= 0xdc00 && code <= 0xdfff && before >= 0xd800 && before <= 0xdbff
      ? 2
      : 1)
  )
}

function fragment(
  text: string,
  from: number,
  through: number,
  budget: number,
  newest: boolean,
): [number, number] {
  let at = newest ? through : from
  while (newest ? at > from : at < through) {
    const index = newest ? previous(text, at) : at
    const next = character(text, index)
    if (next.bytes > budget) break
    budget -= next.bytes
    at = newest ? index : at + next.width
  }
  return newest ? [at, through] : [from, at]
}

/** Budget includes JSON string quotes and escapes. Positions never split a surrogate pair. */
export function transcriptWindow(
  markdown: string,
  request: AgentReadSessionRequest,
  maxBytes: number,
): AgentTranscriptWindow {
  const lines = linesOf(markdown)
  const newest =
    request.startLine === undefined && request.startOffset === undefined
  const budget = Math.max(8, maxBytes) - 2
  let first = newest
    ? lines.length - 1
    : Math.min(Math.max((request.startLine ?? 1) - 1, 0), lines.length - 1)
  let last = first
  let from = lines[first].start
  let through = lines[last].end
  if (newest) {
    if (lines[first].bytes > budget) {
      const range = fragment(markdown, from, through, budget, true)
      from = range[0]
      through = range[1]
    } else {
      let remaining = budget - lines[first].bytes
      while (first > 0 && lines[first - 1].bytes <= remaining) {
        remaining -= lines[--first].bytes
      }
      from = lines[first].start
    }
  } else {
    from += Math.min(request.startOffset ?? 0, Math.max(0, through - from - 1))
    if (from > lines[first].start && previous(markdown, from + 1) === from - 1)
      from--
    const [start, end] = fragment(markdown, from, through, budget, false)
    from = start
    through = end
    if (through === lines[first].end) {
      let remaining = budget
      for (let at = from; at < through;) {
        const next = character(markdown, at)
        remaining -= next.bytes
        at += next.width
      }
      while (last + 1 < lines.length && lines[last + 1].bytes <= remaining) {
        remaining -= lines[++last].bytes
        through = lines[last].end
      }
    }
  }
  const endOffset = through - lines[last].start
  const next =
    through < lines[last].end
      ? { line: last + 1, offset: endOffset }
      : last + 1 < lines.length
        ? { line: last + 2, offset: 0 }
        : null
  return {
    markdown: markdown.slice(from, through),
    startLine: first + 1,
    endLine: last + 1,
    totalLines: lines.length,
    startOffset: from - lines[first].start,
    endOffset,
    next,
  }
}
