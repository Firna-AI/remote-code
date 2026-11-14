import { beforeEach, expect, it, onTestFinished } from 'vitest'
import { mockComputerServer } from '../../test-support/computer-mcp'
import { duringTurn, turn } from '../../test-support/input'
import { instructionProviders } from '../../test-support/instructions'
import { providerFixture } from '../../test-support/fixture'

beforeEach(mockComputerServer)
it.each(['claude', 'codex'] as const)(
  'passes %s fixed instructions and each original sender and attachment to the SDK',
  async (agent) => {
    const h = await providerFixture(agent)
    const provider = instructionProviders(agent)
    const initialPrompt = 'Fixed workspace instructions from Rust.'
    const process = await provider.open({
      ...h.options,
      instructions: initialPrompt,
      conversationId: 'legacy-conversation',
    })
    onTestFinished(() => process.close())
    const first = turn('first', 'alice', agent)
    first.message.sender.id = 'member-alice-id'
    first.message.sender.displayName = ' Alice\r\nExample\u2028 Member '
    first.message.text = '  Keep this text.\n\nAnd this line.  '
    first.message.attachments = [
      {
        id: 'image',
        name: 'image.png',
        path: null,
        kind: 'image',
        mediaType: 'image/png',
        sizeBytes: 10,
      },
      {
        id: 'file',
        name: 'notes.txt',
        path: null,
        kind: 'file',
        mediaType: 'text/plain',
        sizeBytes: 20,
      },
    ]
    first.attachments = [
      { attachmentId: 'image', path: '/uploads/image.png' },
      { attachmentId: 'file', path: '/uploads/notes.txt' },
    ]
    const original = structuredClone(first)
    await process.send(first)
    expect(provider.prompt()).toBe(initialPrompt)
    expect(provider.conversationId()).toBe('legacy-conversation')
    const firstInput = await provider.input()
    expect(firstInput).toMatchObject(
      agent === 'claude'
        ? {
            role: 'user',
            content:
              'Sender: Alice Example Member (@alice) [member ID: "member-alice-id"]\n\n  Keep this text.\n\nAnd this line.  \nThe sender attached these files. Read each file before you answer.\nAttached file: {"name":"image.png","mediaType":"image/png","path":"/uploads/image.png","sizeBytes":10}\nAttached file: {"name":"notes.txt","mediaType":"text/plain","path":"/uploads/notes.txt","sizeBytes":20}',
          }
        : {
            input: [
              {
                type: 'text',
                text: 'Sender: Alice Example Member (@alice) [member ID: "member-alice-id"]\n\n  Keep this text.\n\nAnd this line.  ',
                text_elements: [],
              },
              {
                type: 'text',
                text: 'The sender attached these files. Read each file before you answer. Each image is also in this message.',
                text_elements: [],
              },
              {
                type: 'text',
                text: 'Attached file: {"name":"image.png","mediaType":"image/png","path":"/uploads/image.png","sizeBytes":10}',
                text_elements: [],
              },
              { type: 'localImage', path: '/uploads/image.png' },
              {
                type: 'text',
                text: 'Attached file: {"name":"notes.txt","mediaType":"text/plain","path":"/uploads/notes.txt","sizeBytes":20}',
                text_elements: [],
              },
            ],
          },
    )
    const during = {
      ...duringTurn(turn('during', 'bob', agent)),
      type: 'message' as const,
      turnId: first.turnId,
    }
    during.message.sender.id = 'member-bob-id'
    const originalDuring = structuredClone(during)
    await process.send(during)
    const nextInput = await provider.input(true)
    expect(nextInput).toMatchObject(
      agent === 'claude'
        ? {
            role: 'user',
            content:
              'Sender: @bob [member ID: "member-bob-id"]\n\nChange the file.',
          }
        : {
            input: [
              {
                type: 'text',
                text: 'Sender: @bob [member ID: "member-bob-id"]\n\nChange the file.',
                text_elements: [],
              },
            ],
          },
    )
    expect(first).toEqual(original)
    expect(during).toEqual(originalDuring)
  },
)
