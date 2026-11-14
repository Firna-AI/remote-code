import { randomUUID } from 'node:crypto'

import { query } from '@anthropic-ai/claude-agent-sdk'

import { WORKSPACE_TOOLS_MCP } from '../../../../src/shared/agent-tools'
import {
  attachmentDescription,
  attachmentReadInstruction,
} from './attachment-description'
import { claudeBinary } from './binaries'
import { ClaudeEvents } from './claude-events'
import { ClaudeBackground } from './claude-background'
import { ClaudeBackgroundNote } from './claude-background-note'
import {
  claudeEffortSettings,
  claudeStart,
  type ClaudeEffortSettings,
} from './claude-effort'
import { ClaudeInputWindow } from './claude-input-window'
import { spawnClaudeProcess } from './claude-process'
import { writeClaudeProfile } from './claude-profile'
import { readComputerServer } from './computer-mcp'
import { prepareProviderHome, providerEnvironment } from './environment'
import { failureCause } from './failure'
import { ProviderLifetime } from './lifetime'
import { providerMessage } from './message'
import type { ProviderFactory } from './types'

export interface ClaudeQuery extends AsyncIterable<unknown> {
  interrupt(): Promise<unknown>
  setModel(model?: string): Promise<void>
  setMaxThinkingTokens(tokens: number | null): Promise<void>
  applyFlagSettings(
    settings: ClaudeEffortSettings & { fastMode: boolean },
  ): Promise<void>
  close(): void
}

export type ClaudeQueryFactory = (
  input: Parameters<typeof query>[0],
) => ClaudeQuery

export function createClaudeFactory(
  start: ClaudeQueryFactory = query,
  binary = claudeBinary,
  profile = writeClaudeProfile,
): ProviderFactory {
  return async (options) => {
    options.signal?.throwIfAborted()
    const lifetime = options.lifetime ?? new ProviderLifetime()
    await prepareProviderHome(options.home)
    options.signal?.throwIfAborted()
    const computer = await readComputerServer(options.warn)
    options.signal?.throwIfAborted()
    const preparation =
      options.credential.type === 'gateway'
        ? profile(
            options.home,
            options.sessionId,
            options.endpoint,
            options.credential.token,
          )
        : Promise.resolve(null)
    lifetime.registerCleanup(() =>
      preparation.then(
        (value) => value?.remove(),
        () => {},
      ),
    )
    const credentials = await preparation
    const env = providerEnvironment(
      options.home,
      options.tools,
      options.commitAuthor,
    )
    if (
      options.credential.type === 'gateway' &&
      options.credential.agent === 'claude' &&
      (options.credential.kind === 'token' ||
        options.credential.promptCacheTtl === '1h')
    )
      env.CLAUDE_CODE_PROMPT_CACHE_TTL = '1h'
    if (credentials) {
      env.ANTHROPIC_CONFIG_DIR = credentials.directory
      env.ANTHROPIC_PROFILE = credentials.name
    } else env.ANTHROPIC_BASE_URL = options.endpoint
    const input = new ClaudeInputWindow()
    const background = new ClaudeBackground(options.event)
    const note = new ClaudeBackgroundNote(
      (id) => background.isAmbient(id),
      options.backgroundNoteIds,
    )
    env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS = '1'
    let resultReceived = false
    const mapper = new ClaudeEvents(
      input.ids,
      (event) => {
        if (event.type === 'result') resultReceived = true
        options.event(event)
      },
      (uuid) => input.hasOutstanding(uuid),
      background,
      options.choice.fast,
    )
    let closed = false
    let stream: ClaudeQuery
    try {
      options.signal?.throwIfAborted()
      stream = start({
        prompt: input,
        options: {
          cwd: options.cwd,
          systemPrompt: options.instructions,
          env,
          hooks: {
            Stop: [
              {
                hooks: [
                  async (hook) => {
                    if (
                      !closed &&
                      hook.hook_event_name === 'Stop' &&
                      !hook.agent_id
                    ) {
                      background.stop(hook.session_crons ?? [])
                      const context = note.context(hook)
                      if (context !== undefined) {
                        options.backgroundNotes?.([
                          ...(options.backgroundNoteIds ?? []),
                        ])
                        return {
                          hookSpecificOutput: {
                            hookEventName: 'Stop',
                            additionalContext: context,
                          },
                        }
                      }
                    }
                    return {}
                  },
                ],
              },
            ],
          },
          pathToClaudeCodeExecutable: binary(),
          model: options.choice.model,
          ...claudeStart(options.choice),
          ...(options.conversationId ? { resume: options.conversationId } : {}),
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          includePartialMessages: true,
          persistSession: true,
          settingSources: ['project'],
          mcpServers: {
            conductive: {
              command: WORKSPACE_TOOLS_MCP.command,
              args: [...WORKSPACE_TOOLS_MCP.args],
            },
            ...(computer ? { computer } : {}),
          },
          spawnClaudeCodeProcess: (request) => {
            options.signal?.throwIfAborted()
            return spawnClaudeProcess(
              request,
              options.credential.type === 'native'
                ? options.credential.login
                : null,
              lifetime,
            )
          },
        },
      })
    } catch (error) {
      input.discard()
      await lifetime.close()
      throw error
    }
    void (async () => {
      try {
        for await (const message of stream) {
          if (closed) continue
          resultReceived = false
          mapper.accept(message)
          if (resultReceived) {
            input.complete(message)
            background.result(!input.pending)
          }
        }
        if (!closed)
          options.event({
            type: 'failed',
            code: 'agent_exited',
            message: 'The agent process ended.',
          })
      } catch (error) {
        if (!closed) options.event(failureCause(error))
      }
    })()
    let closing: Promise<void> | null = null
    const close = () => {
      options.signal?.removeEventListener('abort', abort)
      if (closed) return closing ?? lifetime.close()
      closed = true
      input.discard()
      closing = (async () => {
        const exited = lifetime.close()
        try {
          stream.close()
        } finally {
          await exited
        }
      })()
      return closing
    }
    const abort = () => {
      void close().catch((error: unknown) => options.event(failureCause(error)))
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    return {
      send: async (command) => {
        background.input()
        const uuid = randomUUID()
        const attached = command.attachments.length
          ? `\n${attachmentReadInstruction}\n${command.attachments
              .map((item) => attachmentDescription(command, item))
              .join('\n')}`
          : ''
        input.push(command.message.id, {
          type: 'user',
          uuid,
          session_id: options.conversationId ?? '',
          parent_tool_use_id: null,
          message: {
            role: 'user',
            content:
              providerMessage(
                command.message,
                command.branches,
                options.instructionBranches,
              ) + attached,
          },
          priority: 'next',
        })
      },
      model: async (choice) => {
        await stream.setModel(choice.model)
        await stream.applyFlagSettings({
          ...claudeEffortSettings(choice.effort),
          fastMode: choice.fast,
        })
        mapper.speed.mode(choice.fast)
        await stream.setMaxThinkingTokens(choice.effort === 'none' ? 0 : null)
        return 'applied'
      },
      interrupt: async () => {
        mapper.stopped = true
        await stream.interrupt()
      },
      stop: close,
      close,
    }
  }
}
