import type { RunnerBranches } from '../generated/RunnerBranches'
import {
  WORKSPACE_TOOLS_MCP,
  TOOL_ENV,
} from '../../../../src/shared/agent-tools'

import { object, string } from '../parse'
import {
  attachmentDescription,
  attachmentReadInstruction,
} from './attachment-description'
import { codexBinary } from './binaries'
import { writeCodexCredentials } from './codex-credentials'
import { codexNotification } from './codex-events'
import { checkCodexGateway, codexSettings } from './codex-settings'
import { openCodexThread } from './codex-thread'
import { readComputerServer } from './computer-mcp'
import { prepareProviderHome } from './environment'
import { failureCause } from './failure'
import { ProviderLifetime } from './lifetime'
import { providerMessage } from './message'
import { startProcess, type StartProcess } from './process'
import { JsonRpc } from './rpc'
import type { ProviderFactory } from './types'
import type { ProviderInput } from '../generated/ProviderInput'

function input(command: ProviderInput, branches?: RunnerBranches | null) {
  return [
    {
      type: 'text',
      text: providerMessage(command.message, command.branches, branches),
      text_elements: [],
    },
    ...(command.attachments.length
      ? [
          {
            type: 'text',
            text:
              attachmentReadInstruction +
              (command.message.attachments.some((file) => file.kind === 'image')
                ? ' Each image is also in this message.'
                : ''),
            text_elements: [],
          },
        ]
      : []),
    ...command.attachments.flatMap((attachment) => {
      const metadata = command.message.attachments.find(
        (item) => item.id === attachment.attachmentId,
      )
      const description = {
        type: 'text',
        text: attachmentDescription(command, attachment),
        text_elements: [],
      }
      return metadata?.kind === 'image'
        ? [description, { type: 'localImage', path: attachment.path }]
        : [description]
    }),
  ]
}

export function createCodexFactory(
  start: StartProcess = startProcess,
  credentials = writeCodexCredentials,
): ProviderFactory {
  return async (options) => {
    options.signal?.throwIfAborted()
    const lifetime = options.lifetime ?? new ProviderLifetime()
    await prepareProviderHome(options.home)
    options.signal?.throwIfAborted()
    const computer = await readComputerServer(options.warn)
    options.signal?.throwIfAborted()
    const preparation =
      options.credential.type === 'gateway' &&
      options.credential.agent === 'codex' &&
      options.credential.kind === 'token'
        ? credentials(
            options.home,
            options.sessionId,
            options.credential.token,
            options.credential.account,
          )
        : Promise.resolve(null)
    lifetime.registerCleanup(() =>
      preparation.then(
        (value) => value?.remove(),
        () => {},
      ),
    )
    const settings = codexSettings(options)
    try {
      const credential = await preparation
      if (credential) settings.env.CODEX_HOME = credential.directory
      options.signal?.throwIfAborted()
    } catch (error) {
      await lifetime.close()
      throw error
    }
    const configs = {
      ...settings.config,
      'mcp_servers.conductive.command': WORKSPACE_TOOLS_MCP.command,
      'mcp_servers.conductive.args': WORKSPACE_TOOLS_MCP.args,
      'mcp_servers.conductive.env_vars': Object.values(TOOL_ENV),
      ...(computer
        ? {
            'mcp_servers.computer.command': computer.command,
            ...(computer.args
              ? { 'mcp_servers.computer.args': computer.args }
              : {}),
          }
        : {}),
    }
    let activeTurn: string | null = null
    let userIds: string[] = []
    let choice = options.choice
    let activeChoice = choice
    let closed = false
    let rpc: JsonRpc
    try {
      const args = [
        codexBinary(),
        'app-server',
        ...Object.entries(configs).flatMap(([key, value]) => [
          '-c',
          `${key}=${JSON.stringify(value)}`,
        ]),
      ]
      rpc = new JsonRpc(
        start({
          command: process.execPath,
          args,
          cwd: options.cwd,
          env: settings.env,
          signal: options.signal,
          lifetime,
        }),
        (method, params) => {
          if (method === 'turn/started')
            activeTurn = string(object(object(params).turn).id)
          codexNotification(method, params, userIds, options.event)
          if (method === 'turn/completed') activeTurn = null
        },
        () => {
          void lifetime.close().then(
            () => {
              if (!closed)
                options.event({
                  type: 'failed',
                  code: 'agent_exited',
                  message: 'The agent process ended.',
                })
            },
            (error: unknown) => options.event(failureCause(error)),
          )
        },
      )
    } catch (error) {
      await lifetime.close()
      throw error
    }
    let closing: Promise<void> | null = null
    const close = () => {
      closed = true
      activeTurn = null
      userIds = []
      options.signal?.removeEventListener('abort', abort)
      closing ??= rpc.close().finally(() => lifetime.close())
      return closing
    }
    const abort = () => {
      void close().catch((error: unknown) => options.event(failureCause(error)))
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    try {
      await rpc.request('initialize', {
        clientInfo: {
          name: 'conductive',
          title: 'Conductive',
          version: '0.1.0',
        },
        capabilities: { experimentalApi: true },
      })
      rpc.notify('initialized')
      if (settings.tokenMode) await checkCodexGateway(rpc, options.endpoint)
      else
        await rpc.request('account/login/start', {
          type: 'apiKey',
          apiKey:
            options.credential.type === 'gateway'
              ? options.credential.token
              : options.credential.login.secret,
        })
      const threadId = await openCodexThread(
        rpc,
        options,
        settings.modelProvider,
      )
      options.event({ type: 'conversation', id: threadId })
      return {
        send: async (command) => {
          if (activeTurn) {
            const before = [...userIds]
            userIds.push(command.message.id)
            try {
              await rpc.request('turn/steer', {
                threadId,
                expectedTurnId: activeTurn,
                clientUserMessageId: command.message.id,
                input: input(command, options.instructionBranches),
              })
            } catch (error) {
              userIds = before
              throw error
            }
          } else {
            userIds = [command.message.id]
            activeChoice = choice
            if (choice.fast)
              options.event({ type: 'speed', speed: { state: 'fast' } })
            const result = object(
              await rpc.request('turn/start', {
                threadId,
                input: input(command, options.instructionBranches),
                clientUserMessageId: command.message.id,
                model: choice.model,
                effort: choice.effort === 'none' ? 'none' : choice.effort,
                serviceTierForTurn: choice.fast ? 'priority' : 'default',
              }),
            )
            activeTurn = string(object(result.turn).id)
          }
        },
        model: async (next) => {
          choice = next
          return activeTurn &&
            (activeChoice.model !== choice.model ||
              activeChoice.effort !== choice.effort ||
              activeChoice.fast !== choice.fast)
            ? 'deferred'
            : 'applied'
        },
        interrupt: async () => {
          if (activeTurn)
            await rpc.request('turn/interrupt', {
              threadId,
              turnId: activeTurn,
            })
        },
        stop: close,
        close,
      }
    } catch (error) {
      await close()
      throw error
    }
  }
}
