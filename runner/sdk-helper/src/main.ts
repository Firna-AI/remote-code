import { JsonLines } from './json-lines'
import { createClaudeFactory } from './providers/claude'
import { createCodexFactory } from './providers/codex'
import { warmClaude } from './providers/binaries'
import { readRequest } from './read-request'
import { HelperSession } from './session'

const end = () => {
  process.stdin.destroy()
  process.stdout.end()
}
const session = new HelperSession(
  { claude: createClaudeFactory(), codex: createCodexFactory() },
  (output) => process.stdout.write(`${JSON.stringify(output)}\n`),
  warmClaude,
  end,
)
let stopping = false
const stop = () => {
  if (stopping) return
  stopping = true
  void session.close().then(end, () => {
    process.exitCode = 1
    end()
  })
}
const lines = new JsonLines(readRequest, (request) => session.accept(request))
process.stdin.on('data', (chunk: Buffer) => {
  try {
    lines.push(chunk)
  } catch {
    process.exitCode = 1
    stop()
  }
})
process.stdin.on('end', () => {
  try {
    lines.end()
  } catch {
    process.exitCode = 1
  }
  stop()
})
process.stdin.on('error', stop)
process.stdout.on('error', stop)
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
