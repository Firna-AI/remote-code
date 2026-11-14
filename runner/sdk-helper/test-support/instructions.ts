import type { Agent } from '../src/generated/Agent'
import { object } from '../src/parse'
import { createClaudeFactory } from '../src/providers/claude'
import { createCodexFactory } from '../src/providers/codex'
import { FakeAppServers } from './app-server'
import { FakeClaudeQuery } from './claude-query'
import { fakeClaudeProfile } from './profile'

export function instructionProviders(agent: Agent) {
  const queries: FakeClaudeQuery[] = []
  const servers = new FakeAppServers()
  const factories = {
    claude: createClaudeFactory(
      (parameters) => {
        const query = new FakeClaudeQuery()
        queries.push(query)
        return query.open(parameters)
      },
      () => '/fake/claude',
      fakeClaudeProfile,
    ),
    codex: createCodexFactory(servers.start),
  }
  const query = () => {
    const value = queries.at(-1)
    if (!value) throw new Error('The test did not start Claude.')
    return value
  }
  const thread = () =>
    object(
      servers.latest.writes.find(
        (write) =>
          write.method === 'thread/start' || write.method === 'thread/resume',
      )?.params,
    )
  return {
    open: factories[agent],
    prompt: () =>
      agent === 'claude'
        ? query().parameters?.options?.systemPrompt
        : thread().developerInstructions,
    conversationId: () =>
      agent === 'claude'
        ? query().parameters?.options?.resume
        : thread().threadId,
    input: async (during = false) =>
      agent === 'claude'
        ? (await query().nextUser()).message
        : object(
            servers.latest.writes.find(
              (write) =>
                write.method === (during ? 'turn/steer' : 'turn/start'),
            )?.params,
          ),
    parameters: () =>
      agent === 'claude' ? query().parameters?.options : thread(),
    environment: () =>
      agent === 'claude'
        ? query().parameters?.options?.env
        : servers.requests.at(-1)?.env,
  }
}
