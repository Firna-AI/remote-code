import type { Workspace } from '../../shared/generated/Workspace'
// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { routes } from '../../app/router'

import { accessibleName } from '../../test-support/dom-queries'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { LinksProvider } from '../links/LinksContext'
import { AgentText } from './AgentText'

/** An answer as the chat draws it, in a page that the test can read. */
function render(text: string): HTMLElement {
  const page = document.createElement('div')
  page.innerHTML = renderToStaticMarkup(<AgentText text={text} />)
  return page
}

/** The text of each cell of a table, row by row, from the header row. */
function rowsOf(table: Element): string[][] {
  return Array.from(table.querySelectorAll('tr'), (row) =>
    Array.from(row.children, (cell) => cell.textContent ?? ''),
  )
}

/**
 * The blocks of an answer in order: a paragraph and a list item as their
 * text, and a table as its rows.
 */
function blocks(page: HTMLElement): (string | string[][])[] {
  return Array.from(page.querySelectorAll('p, li, table'), (block) =>
    block.tagName === 'TABLE' ? rowsOf(block) : (block.textContent ?? ''),
  )
}

/** Each cell of each table row as its text, with its alignment and its span. */
function layout(page: HTMLElement): string[][] {
  return Array.from(page.querySelectorAll('tr'), (row) =>
    Array.from(row.children, (cell) => {
      const align = cell instanceof HTMLElement ? cell.style.textAlign : ''
      const span = cell.getAttribute('colspan')
      const notes = [align, span === null ? '' : `span ${span}`].filter(
        (note) => note !== '',
      )
      const text = cell.textContent ?? ''
      return notes.length > 0 ? `${text} (${notes.join(', ')})` : text
    }),
  )
}

it('shows the table of an answer between its paragraphs as a table, row by row', () => {
  const intro =
    'I run in a KVM virtual machine with 4 vCPUs, 7.8 GiB of RAM, and a 79 GiB disk.'
  const outro =
    'The physical host has an 8-core Ryzen 7 9700X, but this VM gets only 4 of those cores.'
  const page = render(
    [
      intro,
      '',
      '| Resource | Value |',
      '|---|---|',
      '| Virtualization | KVM virtual machine |',
      '| CPU | 4 vCPUs, 1 thread per core, AMD Ryzen 7 9700X |',
      '| Memory | 7.8 GiB total, about 6.0 GiB available, plus 2.0 GiB swap (none used) |',
      '| Disk (`/home`) | 79 GiB total, 54 GiB free (30% used) |',
      '| OS | Linux 6.8.0-117-generic |',
      '',
      outro,
    ].join('\n'),
  )
  expect(blocks(page)).toEqual([
    intro,
    [
      ['Resource', 'Value'],
      ['Virtualization', 'KVM virtual machine'],
      ['CPU', '4 vCPUs, 1 thread per core, AMD Ryzen 7 9700X'],
      [
        'Memory',
        '7.8 GiB total, about 6.0 GiB available, plus 2.0 GiB swap (none used)',
      ],
      ['Disk (/home)', '79 GiB total, 54 GiB free (30% used)'],
      ['OS', 'Linux 6.8.0-117-generic'],
    ],
    outro,
  ])
})

it('aligns each column, also its header cell, by the colons of its separator cell', () => {
  const page = render(
    [
      '| Bundle | Main | Change | Owner |',
      '| --- | ---: | :---: | :--- |',
      '| checkout | 182 KB | +7 KB | web |',
    ].join('\n'),
  )
  expect(layout(page)).toEqual([
    ['Bundle', 'Main (right)', 'Change (center)', 'Owner (left)'],
    ['checkout', '182 KB (right)', '+7 KB (center)', 'web (left)'],
  ])
})

it('shows an escaped pipe, inline code, and strong text in a cell, and its HTML as text', () => {
  const page = render(
    [
      '| Command | Result |',
      '| --- | --- |',
      '| `grep a \\| wc -l` | **2** lines |',
      '| <img src=x onerror=alert(1)> | <b>bold</b> |',
    ].join('\n'),
  )
  expect({
    rows: blocks(page),
    code: page.querySelector('td code')?.textContent,
    strong: page.querySelector('td strong')?.textContent,
    html: page.querySelectorAll('img, b').length,
  }).toEqual({
    rows: [
      [
        ['Command', 'Result'],
        ['grep a | wc -l', '2 lines'],
        ['<img src=x onerror=alert(1)>', '<b>bold</b>'],
      ],
    ],
    code: 'grep a | wc -l',
    strong: '2',
    html: 0,
  })
})

it('shows a workspace link in a table cell as its chip, and a link in code as code', () => {
  const linked = workspaceFixtures().workspaces.workspaces[0] as Workspace
  const page = document.createElement('div')
  page.innerHTML = renderToStaticMarkup(
    <LinksProvider
      value={{ links: { orgId: FAKE_IDS.org, workspaces: [linked] } }}
    >
      <AgentText
        text={[
          '| Workspace | Command |',
          '| --- | --- |',
          `| [W-${linked.number}](${linked.link}) | \`open ${linked.link}\` |`,
          `| ${linked.link} | Run it there. |`,
        ].join('\n')}
      />
    </LinksProvider>,
  )
  const chip = `${routes.workspace(FAKE_IDS.org, linked.id)} W-${linked.number} ${linked.name}, Starting`
  expect(
    Array.from(page.querySelectorAll('td'), (cell) => ({
      chips: Array.from(
        cell.querySelectorAll('a'),
        (link) => `${link.getAttribute('href')} ${accessibleName(link)}`,
      ),
      code: Array.from(
        cell.querySelectorAll('code'),
        (code) => code.textContent,
      ),
    })),
  ).toEqual([
    { chips: [chip], code: [] },
    { chips: [], code: [`open ${linked.link}`] },
    { chips: [chip], code: [] },
    { chips: [], code: [] },
  ])
})

it('starts a table directly after a line of a paragraph or a list, and ends it at a line without a pipe', () => {
  const page = render(
    [
      'The sizes are:',
      '| Bundle | Main |',
      '| --- | --- |',
      '| checkout | 182 KB |',
      'The places proxy runs on the server.',
      '- Then the tests:',
      '| Test | Time |',
      '| --- | --- |',
      '| unit | 41s |',
    ].join('\n'),
  )
  expect(blocks(page)).toEqual([
    'The sizes are:',
    [
      ['Bundle', 'Main'],
      ['checkout', '182 KB'],
    ],
    'The places proxy runs on the server.',
    'Then the tests:',
    [
      ['Test', 'Time'],
      ['unit', '41s'],
    ],
  ])
})

it('keeps a table in a code block as code, and shows rows with a separator of another width as text', () => {
  const page = render(
    [
      '```',
      '| Bundle | Main |',
      '| --- | --- |',
      '```',
      '| Bundle | Main | Change |',
      '| --- | --- |',
      '| checkout | 182 KB | +7 KB |',
    ].join('\n'),
  )
  expect({
    code: page.querySelector('pre')?.textContent,
    blocks: blocks(page),
  }).toEqual({
    code: '| Bundle | Main |\n| --- | --- |',
    blocks: [
      '| Bundle | Main | Change | | --- | --- | | checkout | 182 KB | +7 KB |',
    ],
  })
})

it('shows the cells of each row up to the width of the header, and spans the missing columns from the last cell of a short row, with no alignment', () => {
  const page = render(
    [
      '| Bundle | Main | This branch | Change |',
      '| --- | ---: | ---: | ---: |',
      '| checkout | 182 KB | 189 KB | +7 KB | 2 files |',
      '| api/places | Server only |',
    ].join('\n'),
  )
  expect(layout(page)).toEqual([
    ['Bundle', 'Main (right)', 'This branch (right)', 'Change (right)'],
    ['checkout', '182 KB (right)', '189 KB (right)', '+7 KB (right)'],
    ['api/places', 'Server only (span 3)'],
  ])
})

it('spans at most 1,000 columns, and leaves the columns after the span empty', () => {
  const head = Array.from({ length: 1_002 }, (_, index) => `c${index + 1}`)
  const page = render(
    [`| ${head.join(' | ')} |`, `|${'---|'.repeat(1_002)}`, '| total |'].join(
      '\n',
    ),
  )
  const [header, row] = layout(page)
  expect({ columns: header?.length, row }).toEqual({
    columns: 1_002,
    row: ['total (span 1000)'],
  })
})

it('draws each heading at the level that the agent wrote, with its code, strong text, and workspace chip, and draws no empty heading', () => {
  const linked = workspaceFixtures().workspaces.workspaces[0] as Workspace
  const page = document.createElement('div')
  page.innerHTML = renderToStaticMarkup(
    <LinksProvider
      value={{ links: { orgId: FAKE_IDS.org, workspaces: [linked] } }}
    >
      <AgentText
        text={[
          '# Review of #482',
          '## Needs your answer',
          '### 1. Wait in `useAddressAutocomplete`',
          '#### How **I** checked',
          '##### Unit tests',
          `###### Compare ${linked.link}`,
          '## ',
        ].join('\n')}
      />
    </LinksProvider>,
  )
  const chip = `W-${linked.number} ${linked.name}, Starting`
  expect({
    headings: Array.from(
      page.querySelectorAll('h1, h2, h3, h4, h5, h6'),
      (heading) => `${heading.tagName} ${accessibleName(heading)}`,
    ),
    code: page.querySelector('h3 > code')?.textContent,
    strong: page.querySelector('h4 > strong')?.textContent,
    chip: page.querySelector('h6 > a')?.getAttribute('href'),
  }).toEqual({
    headings: [
      'H1 Review of #482',
      'H2 Needs your answer',
      'H3 1. Wait in useAddressAutocomplete',
      'H4 How I checked',
      'H5 Unit tests',
      `H6 Compare ${chip}`,
    ],
    code: 'useAddressAutocomplete',
    strong: 'I',
    chip: routes.workspace(FAKE_IDS.org, linked.id),
  })
})
