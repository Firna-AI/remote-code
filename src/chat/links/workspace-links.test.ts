import type { Workspace } from '../../shared/generated/Workspace'
import { describe, expect, test } from 'vitest'
import { routes } from '../../app/router'

import { FAKE_IDS, FAKE_ORIGIN } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { chatParts, type ChatPart } from './chat-parts'
import { linkTarget, textParts, type WorkspaceLinks } from './workspace-links'

const { org } = FAKE_IDS
const listed = workspaceFixtures().workspaces.workspaces
const first = listed[0] as Workspace
const second = { ...(listed[1] as Workspace), state: 'archived' as const }
const links = { orgId: org, workspaces: [first, second] }

/** The web address of a page of the app, as a person copies it. */
const address = (path: string) => `${FAKE_ORIGIN}${path}`

/** The parts in a short form: text, code, or the ID and page of a chip. */
function shapes(parts: readonly ChatPart[]) {
  return parts.map((part) => {
    if (part.kind === 'chip') {
      return { chip: part.target.workspace.id, to: part.target.to }
    }
    if (part.kind === 'attachment') return { attachment: part.attachment.id }
    return part.kind === 'file'
      ? { file: part.entry.path }
      : { [part.kind]: part.text }
  })
}

/** The parts of a sent message, as the chat reads it. */
const messageParts = (text: string, list: WorkspaceLinks = links) =>
  chatParts(text, list, { strong: false })

/** The parts of the text of a message field, with a chip for each link. */
function fieldShapes(text: string) {
  return textParts(text).map((part) => {
    const target = part.kind === 'link' ? linkTarget(part.href, links) : null
    return target
      ? { chip: target.workspace.id, to: target.to }
      : { text: part.kind === 'link' ? part.source : part.text }
  })
}

describe('the workspace links of a text', () => {
  test('a link to a workspace, with or without a tab, becomes a chip that keeps the page', () => {
    const tab = routes.workspace(org, first.id, 'files', 'src/cart.ts')
    const text = `Read ${first.link} and ${address(`${tab}?line=2#diff`)}`
    expect(shapes(messageParts(text))).toEqual([
      { text: 'Read ' },
      { chip: first.id, to: routes.workspace(org, first.id) },
      { text: ' and ' },
      { chip: first.id, to: `${tab}?line=2#diff` },
    ])
  })

  test('a Markdown link to a workspace is the chip alone, and other Markdown links stay as written', () => {
    const other = '[the docs](https://example.com/docs)'
    const text = `Done: [W-${first.number}](${first.link}) and <${second.link}>, see ${other}`
    const parts = messageParts(text)
    expect(shapes(parts)).toEqual([
      { text: 'Done: ' },
      { chip: first.id, to: routes.workspace(org, first.id) },
      { text: ' and <' },
      { chip: second.id, to: routes.workspace(org, second.id) },
      { text: `>, see ${other}` },
    ])
    expect(parts[1]).toMatchObject({
      source: `[W-${first.number}](${first.link})`,
    })
  })

  test('a link in code stays code in a message, and a message field reads no code', () => {
    const text = `Run \`open ${first.link}\` now`
    expect(shapes(messageParts(text))).toEqual([
      { text: 'Run ' },
      { code: `open ${first.link}` },
      { text: ' now' },
    ])
    expect(fieldShapes(text)).toEqual([
      { text: 'Run `open ' },
      { chip: first.id, to: routes.workspace(org, first.id) },
      { text: '` now' },
    ])
  })

  test('a Markdown link with a code label in a sent message is the chip alone', () => {
    const text = `See [\`W-${first.number}\`](${first.link}) now`
    expect(shapes(messageParts(text))).toEqual([
      { text: 'See ' },
      { chip: first.id, to: routes.workspace(org, first.id) },
      { text: ' now' },
    ])
  })

  test('a link with `..` shows the workspace whose page it opens', () => {
    const odd = address(`${routes.workspace(org, first.id)}/../${second.id}`)
    expect(shapes(messageParts(odd))).toEqual([
      { chip: second.id, to: routes.workspace(org, second.id) },
    ])
  })

  test('a link of another origin or org, an unknown workspace, or a list that still loads stays text', () => {
    const path = routes.workspace(org, first.id)
    const others = [
      `https://elsewhere.example${path}`,
      address(routes.workspace('globex', first.id)),
      address(routes.workspace(org, 'not-in-the-list')),
      address(routes.org(org)),
    ]
    for (const link of others) {
      expect(shapes(messageParts(`See ${link}`))).toEqual([
        { text: `See ${link}` },
      ])
    }
    const loading = { orgId: org, workspaces: null }
    expect(shapes(messageParts(first.link, loading))).toEqual([
      { text: first.link },
    ])
  })

  test('punctuation next to a link stays text', () => {
    const text = `(${first.link}), ${second.link}. "${first.link}"!`
    expect(shapes(messageParts(text))).toEqual([
      { text: '(' },
      { chip: first.id, to: routes.workspace(org, first.id) },
      { text: '), ' },
      { chip: second.id, to: routes.workspace(org, second.id) },
      { text: '. "' },
      { chip: first.id, to: routes.workspace(org, first.id) },
      { text: '"!' },
    ])
  })
})
