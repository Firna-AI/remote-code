import type { ToolCall } from '../generated/ToolCall'
import { object, string } from '../parse'

/** The arguments that can name the subject of a call, in order. */
const SUBJECT_KEYS = [
  'file_path',
  'path',
  'command',
  'pattern',
  'query',
  'url',
] as const

/**
 * Maps one tool call to its chat line. A call to a tool of an MCP server
 * shows `mcpTool`, its name without the server, and its subject as the
 * detail. Any other call shows its subject, and its description as the
 * detail.
 */
export function mapTool(
  id: string,
  name: string,
  input: unknown,
  state: ToolCall['state'],
  mcpTool: string | null = null,
): ToolCall {
  let subject: string | null = null
  let description: string | null = null
  if (input !== null && typeof input === 'object') {
    const args = object(input)
    const key = SUBJECT_KEYS.find((item) => typeof args[item] === 'string')
    if (key) subject = string(args[key])
    if (typeof args.description === 'string') description = args.description
  }
  const target = mcpTool ?? subject ?? name
  const detail = mcpTool === null ? description : (subject ?? description)
  const lower = name.toLowerCase()
  const kind = /computer|browser/.test(lower)
    ? 'computer'
    : /read/.test(lower)
      ? 'read'
      : /search|grep|glob/.test(lower)
        ? 'search'
        : /write|create/.test(lower)
          ? 'create'
          : /edit|patch|filechange/.test(lower)
            ? 'edit'
            : /bash|command|exec|shell/.test(lower)
              ? 'run'
              : 'other'
  return { id, kind, target, detail, omittedDetailBytes: 0, state }
}
