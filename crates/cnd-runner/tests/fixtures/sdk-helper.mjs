/** Fake SDK helper. Requests use the production JSON-line protocol. */
import { createInterface } from 'node:readline'

const lines = createInterface({ input: process.stdin })
/** @type {string | undefined} */
let held
let complete = false
/** @param {object} value */
function output(value) {
  process.stdout.write(JSON.stringify(value) + '\n')
}
/** @param {string} requestId @param {string | null} result */
function response(requestId, result = null) {
  output({ type: 'response', requestId, result })
}
for await (const line of lines) {
  const request = JSON.parse(line)
  switch (request.type) {
    case 'warm':
      response(request.requestId)
      process.stdout.end(() => process.exit(0))
      break
    case 'start':
      complete = request.options.choice.model === 'complete'
      if (complete)
        output({
          type: 'event',
          event: { type: 'conversation', id: 'subprocess-conversation' },
        })
      if (request.options.choice.model === 'exit') process.exit(1)
      if (request.options.choice.model === 'malformed') {
        process.stdout.write('{bad\n')
        break
      }
      if (request.options.choice.model === 'hold') {
        held = request.requestId
        output({ type: 'warning', message: 'start held' })
      } else response(request.requestId)
      break
    case 'model':
      response(request.requestId, 'deferred')
      if (held) response(held)
      held = undefined
      break
    case 'send': {
      const bytes = Buffer.from(
        JSON.stringify({
          type: 'event',
          event: {
            type: 'delta',
            messageId: 'answer',
            text: complete ? 'Hello secret-alice 😀' : 'Hello 😀',
          },
        }) + '\n',
      )
      const split = bytes.indexOf(Buffer.from('😀')) + 1
      process.stdout.write(bytes.subarray(0, split))
      process.stdout.write(bytes.subarray(split))
      response(request.requestId)
      if (complete) {
        output({
          type: 'event',
          event: {
            type: 'answer',
            messageId: 'answer',
            text: 'Hello secret-alice 😀',
            userMessageIds: [request.input.message.id],
          },
        })
        output({
          type: 'event',
          event: {
            type: 'result',
            state: 'finished',
            userMessageIds: [request.input.message.id],
          },
        })
      }
      break
    }
    case 'interrupt':
      output({
        type: 'error',
        requestId: request.requestId,
        code: 'interrupt_failed',
        message: 'Controlled request failure.',
      })
      break
    case 'close':
      response(request.requestId)
      output({ type: 'exit' })
      process.stdout.end(() => process.exit(0))
      break
  }
}
