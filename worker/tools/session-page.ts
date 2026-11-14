import type { AgentListSessionsRequest } from '../../src/shared/generated/AgentListSessionsRequest'

import { HttpError } from '../http'

function invalidInput(): never {
  throw new HttpError(
    400,
    'invalid_input',
    'Check the session list options and try again.',
  )
}

export function sessionPageInput(
  query: URLSearchParams,
): AgentListSessionsRequest {
  const page: AgentListSessionsRequest = {}
  for (const field of ['limit', 'offset'] as const) {
    const value = query.get(field)
    if (value === null) continue
    const number = Number(value)
    if (
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(number) ||
      (field === 'limit' && (number < 1 || number > 100))
    )
      return invalidInput()
    page[field] = number
  }
  return page
}
