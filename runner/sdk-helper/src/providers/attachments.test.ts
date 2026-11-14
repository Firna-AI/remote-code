import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import type { Agent } from '../generated/Agent'
import { FakeAppServers } from '../../test-support/app-server'
import { FakeClaudeQuery } from '../../test-support/claude-query'
import { mockComputerServer } from '../../test-support/computer-mcp'
import { turn } from '../../test-support/input'
import { fakeToolContext } from '../../test-support/input'
import { createClaudeFactory } from './claude'
import { createCodexFactory } from './codex'
import * as environment from './environment'
import type { ProviderOptions } from './types'

beforeEach(() => {
  mockComputerServer()
  const prepare = vi
    .spyOn(environment, 'prepareProviderHome')
    .mockResolvedValue()
  onTestFinished(() => prepare.mockRestore())
})

function attachedTurn(agent: Agent) {
  const command = turn('attachments', 'alice', agent)
  command.message.attachments = [
    {
      id: 'image',
      name: 'Screenshot.PNG',
      path: null,
      kind: 'image',
      mediaType: 'image/png',
      sizeBytes: 12,
    },
    {
      id: 'pdf',
      name: 'Plan "A".PDF',
      path: null,
      kind: 'file',
      mediaType: 'application/pdf',
      sizeBytes: 23,
    },
  ]
  command.attachments = [
    {
      attachmentId: 'pdf',
      path: '/test/repository/.context/attachments/11111111111111111111111111111111/Plan-A.pdf',
    },
    {
      attachmentId: 'image',
      path: '/test/repository/.context/attachments/22222222222222222222222222222222/Screenshot.png',
    },
  ]
  const options: ProviderOptions = {
    cwd: '/test/repository',
    home: '/test/home',
    sessionId: command.sessionId,
    endpoint: `${fakeToolContext.machineOrigin}/v1/model/${agent}`,
    credential: { type: 'gateway', ...command.credential },
    commitAuthor: null,
    choice: command.message.choice,
    conversationId: null,
    instructions: 'Read each attached file before answering.',
    tools: fakeToolContext,
    event: () => {},
    warn: () => {},
  }
  return { command, options }
}

it('gives Claude original attachment metadata and copied paths', async () => {
  const { command, options } = attachedTurn('claude')
  const sdk = new FakeClaudeQuery()
  const provider = await createClaudeFactory(
    sdk.open,
    () => '/fake/claude',
    async () => ({
      directory: '/test/home/.conductive/anthropic',
      name: 'session-attachments',
      remove: async () => {},
    }),
  )(options)
  onTestFinished(() => provider.close())
  await provider.send(command)
  expect((await sdk.nextUser()).message.content).toBe(
    'Sender: @alice [member ID: "alice"]\n\nChange the file.\n' +
      'The sender attached these files. Read each file before you answer.\n' +
      'Attached file: {"name":"Plan \\"A\\".PDF","mediaType":"application/pdf","path":"/test/repository/.context/attachments/11111111111111111111111111111111/Plan-A.pdf","sizeBytes":23}\n' +
      'Attached file: {"name":"Screenshot.PNG","mediaType":"image/png","path":"/test/repository/.context/attachments/22222222222222222222222222222222/Screenshot.png","sizeBytes":12}',
  )
})

it('gives Codex original attachment metadata and keeps local image inputs', async () => {
  const { command, options } = attachedTurn('codex')
  const servers = new FakeAppServers()
  const provider = await createCodexFactory(servers.start)(options)
  onTestFinished(() => provider.close())
  await provider.send(command)
  expect(
    servers.latest.writes.find((write) => write.method === 'turn/start'),
  ).toMatchObject({
    params: {
      input: [
        {
          type: 'text',
          text: 'Sender: @alice [member ID: "alice"]\n\nChange the file.',
          text_elements: [],
        },
        {
          type: 'text',
          text: 'The sender attached these files. Read each file before you answer. Each image is also in this message.',
          text_elements: [],
        },
        {
          type: 'text',
          text: 'Attached file: {"name":"Plan \\"A\\".PDF","mediaType":"application/pdf","path":"/test/repository/.context/attachments/11111111111111111111111111111111/Plan-A.pdf","sizeBytes":23}',
          text_elements: [],
        },
        {
          type: 'text',
          text: 'Attached file: {"name":"Screenshot.PNG","mediaType":"image/png","path":"/test/repository/.context/attachments/22222222222222222222222222222222/Screenshot.png","sizeBytes":12}',
          text_elements: [],
        },
        {
          type: 'localImage',
          path: '/test/repository/.context/attachments/22222222222222222222222222222222/Screenshot.png',
        },
      ],
    },
  })
  command.message.attachments = command.message.attachments.filter(
    (attachment) => attachment.kind === 'file',
  )
  command.attachments = command.attachments.filter(
    (attachment) => attachment.attachmentId === 'pdf',
  )
  await provider.send(command)
  expect(
    servers.latest.writes.find((write) => write.method === 'turn/steer'),
  ).toMatchObject({
    params: {
      input: [
        {
          type: 'text',
          text: 'Sender: @alice [member ID: "alice"]\n\nChange the file.',
          text_elements: [],
        },
        {
          type: 'text',
          text: 'The sender attached these files. Read each file before you answer.',
          text_elements: [],
        },
        {
          type: 'text',
          text: 'Attached file: {"name":"Plan \\"A\\".PDF","mediaType":"application/pdf","path":"/test/repository/.context/attachments/11111111111111111111111111111111/Plan-A.pdf","sizeBytes":23}',
          text_elements: [],
        },
      ],
    },
  })
  const branchCommand = attachedTurn('codex').command
  await provider.send({
    ...branchCommand,
    message: {
      ...branchCommand.message,
      id: 'attachment-with-current-branches',
    },
    branches: { workspaceBranch: 'owner/next', targetBranch: 'trunk' },
  })
  expect(
    servers.latest.writes.findLast((write) => write.method === 'turn/steer'),
  ).toMatchObject({
    params: {
      input: [
        {
          type: 'text',
          text: 'Sender: @alice [member ID: "alice"]\nCurrent branches: workspace "owner/next"; target "trunk".\n\nChange the file.',
          text_elements: [],
        },
        {
          type: 'text',
          text: 'The sender attached these files. Read each file before you answer. Each image is also in this message.',
          text_elements: [],
        },
        {
          type: 'text',
          text: 'Attached file: {"name":"Plan \\"A\\".PDF","mediaType":"application/pdf","path":"/test/repository/.context/attachments/11111111111111111111111111111111/Plan-A.pdf","sizeBytes":23}',
          text_elements: [],
        },
        {
          type: 'text',
          text: 'Attached file: {"name":"Screenshot.PNG","mediaType":"image/png","path":"/test/repository/.context/attachments/22222222222222222222222222222222/Screenshot.png","sizeBytes":12}',
          text_elements: [],
        },
        {
          type: 'localImage',
          path: '/test/repository/.context/attachments/22222222222222222222222222222222/Screenshot.png',
        },
      ],
    },
  })
})
