import { expect, it } from 'vitest'

import type { HelperOutput } from './generated/HelperOutput'
import { JsonLines } from './json-lines'
import { readOutput } from './read-output'

it('frames several messages and preserves partial UTF-8 and escaped newlines', () => {
  const output: HelperOutput[] = []
  const lines = new JsonLines(readOutput, (message) => output.push(message))
  const bytes = Buffer.from(
    '{"type":"warning","message":"hé\\nllo"}\n{"type":"exit"}\n',
  )
  const split = bytes.indexOf(Buffer.from('é')) + 1
  lines.push(bytes.subarray(0, split))
  expect(output).toEqual([])
  lines.push(bytes.subarray(split, bytes.length - 3))
  expect(output).toEqual([{ type: 'warning', message: 'hé\nllo' }])
  lines.push(bytes.subarray(bytes.length - 3))
  lines.end()
  expect(output).toEqual([
    { type: 'warning', message: 'hé\nllo' },
    { type: 'exit' },
  ])
})

it('rejects malformed JSON and malformed message fields before delivery', () => {
  const output: HelperOutput[] = []
  const lines = new JsonLines(readOutput, (message) => output.push(message))
  expect(() => lines.push(Buffer.from('private malformed bytes\n'))).toThrow()
  expect(() =>
    lines.push(
      Buffer.from(
        '{"type":"event","event":{"type":"result","state":"finished","userMessageIds":42}}\n',
      ),
    ),
  ).toThrow('Expected a list.')
  expect(output).toEqual([])
})

it('rejects an incomplete final line instead of silently losing it', () => {
  const lines = new JsonLines(readOutput, () => {})
  lines.push(Buffer.from('{"type":"exit"}'))
  expect(() => lines.end()).toThrow('The helper JSON line is incomplete.')
})
