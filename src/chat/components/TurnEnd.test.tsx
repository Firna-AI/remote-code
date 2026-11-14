// @vitest-environment happy-dom

import { expect, it, vi } from 'vitest'
import type { ChangedFile } from '../../shared/generated/ChangedFile'
import { TouchScreen } from '../../../docs/mockups/src/components/common/touch'
import { accessibleName, byRole } from '../../test-support/dom-queries'
import { mount, MOUNTED_TEST_TIMEOUT, press } from '../../test-support/mount'
import { TurnEnd } from './TurnEnd'

vi.setConfig({ testTimeout: MOUNTED_TEST_TIMEOUT })

it('names each changed file of a turn by its label, and opens the diff of its real path', async () => {
  const opened: string[] = []
  const view = await mount(
    <TurnEnd
      durationMs={1_000}
      files={[
        {
          path: 'scripts/seed-acme-7f3k.sql',
          displayPath: 'scripts/seed-[redacted].sql',
          change: 'added',
          added: 6,
          removed: 0,
        },
        { path: 'README.md', change: 'modified', added: 1, removed: 0 },
      ]}
      filesUnavailable={false}
      omittedFiles={0}
      onOpenDiff={(path) => opened.push(path)}
    />,
  )
  const chips = [...view.container.querySelectorAll('button')]
  for (const chip of chips) await press(chip)
  expect({
    names: chips.map(accessibleName),
    leaks: view.container.innerHTML.includes('acme-7f3k'),
    opened,
  }).toEqual({
    names: [
      'Open the changes of scripts/seed-[redacted].sql',
      'Open the changes of README.md',
    ],
    leaks: false,
    opened: ['scripts/seed-acme-7f3k.sql', 'README.md'],
  })
})

function manyFiles(count: number): ChangedFile[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `src/file-${index + 1}.ts`,
    change: 'modified' as const,
    added: 1,
    removed: 0,
  }))
}

/** The text of each chip of `manyFiles`: its name and its added lines. */
function chipTexts(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `file-${index + 1}.ts+1`)
}

function chipNames(root: ParentNode): string[] {
  return [...root.querySelectorAll('li')].map((item) => item.textContent ?? '')
}

it('shows 8 files on desktop, then shows all of them and the unlisted count after Show more', async () => {
  const view = await mount(
    <TurnEnd
      durationMs={1_000}
      files={manyFiles(12)}
      filesUnavailable={false}
      omittedFiles={47}
      onOpenDiff={() => undefined}
    />,
  )
  const before = chipNames(view.container)
  const button = byRole('button', 'Show 4 more changed files', view.container)
  await press(button)
  expect({
    before,
    after: chipNames(view.container),
    focused: document.activeElement?.getAttribute('aria-label'),
  }).toEqual({
    before: [...chipTexts(8), 'Show 4 more'],
    after: [...chipTexts(12), '47 more files'],
    focused: 'Open the changes of src/file-9.ts',
  })
})

it('shows 5 files on a phone', async () => {
  const view = await mount(
    <TouchScreen>
      <TurnEnd
        durationMs={1_000}
        files={manyFiles(6)}
        filesUnavailable={false}
        omittedFiles={0}
      />
    </TouchScreen>,
  )
  expect(chipNames(view.container)).toEqual([...chipTexts(5), 'Show 1 more'])
})

it('shows no button when the files fit', async () => {
  const view = await mount(
    <TurnEnd
      durationMs={1_000}
      files={manyFiles(8)}
      filesUnavailable={false}
      omittedFiles={0}
    />,
  )
  expect(view.container.querySelector('button')).toBeNull()
})

it('shows no line counts on a file without line changes', async () => {
  const view = await mount(
    <TurnEnd
      durationMs={1_000}
      files={[
        { path: 'logo.png', change: 'modified', added: 0, removed: 0 },
        { path: 'old.ts', change: 'deleted', added: 0, removed: 4 },
      ]}
      filesUnavailable={false}
      omittedFiles={0}
      onOpenDiff={() => undefined}
    />,
  )
  expect({
    names: chipNames(view.container),
    stats: view.container.querySelectorAll('[role="img"]').length,
  }).toEqual({ names: ['logo.png', 'old.ts−4'], stats: 1 })
})
