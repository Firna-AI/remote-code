import { act, useState } from 'react'
import type { FileEntry } from '../../../shared/generated/FileEntry'
import { accessibleName, byRole } from '../../../test-support/dom-queries'
import { filesAfterHistory, startFiles } from '../../../files/files-test-kit'
import type { FakeApiServer } from '../../../test-support/fake-api'
import { FAKE_IDS } from '../../../test-support/fixtures/core'
import { mount } from '../../../test-support/mount'
import { LinksProvider } from '../../links/LinksContext'
import {
  MentionsProvider,
  type ChatMentions,
  type MentionFilesSnapshot,
} from '../../mentions/MentionsContext'
import { ChipTextField } from './ChipTextField'

// Mounts the message field of a chat with the files of its workspace, as
// the composer does, for the tests of the list of `@` and the file chips.

export function entry(
  path: string,
  kind: FileEntry['kind'] = 'file',
): FileEntry {
  return { path, name: path.split('/').at(-1) ?? path, kind, change: null }
}

export const sampleTree: readonly FileEntry[] = [
  entry('src', 'directory'),
  entry('src/app', 'directory'),
  entry('src/app/api', 'directory'),
  entry('src/app/api/addresses', 'directory'),
  entry('src/app/api/addresses/route.ts'),
  entry('src/app/checkout', 'directory'),
  entry('src/app/checkout/AddressForm.tsx'),
  entry('src/app/checkout/useAddressAutocomplete.ts'),
  entry('src/lib', 'directory'),
  entry('docs', 'directory'),
  entry('docs/My notes.md'),
  entry('README.md'),
]

/**
 * A store of the kept files with only two plain states: no tree yet, and a
 * tree of entries. The states that the cloud computer marks, such as an
 * unavailable tree or a failed read, come from the real store of the Files
 * screens over the fake API, as `realFiles` gives it.
 */
export class FakeFiles {
  private snapshot: MentionFilesSnapshot
  private readonly listeners = new Set<() => void>()

  constructor(entries: readonly FileEntry[] | null) {
    this.snapshot = FakeFiles.of(entries)
  }

  private static of(entries: readonly FileEntry[] | null) {
    return {
      tree: entries
        ? { entries: new Map(entries.map((item) => [item.path, item])) }
        : null,
      treeError: null,
      treeUnavailable: false,
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.snapshot

  set(entries: readonly FileEntry[] | null) {
    this.snapshot = FakeFiles.of(entries)
    this.listeners.forEach((listener) => listener())
  }
}

/**
 * The real store of the Files screens, started over the fake API, after
 * its routes answered. Serve the tree reply first, such as an unavailable
 * tree or a failed read.
 */
export async function realFiles(server: FakeApiServer) {
  const files = filesAfterHistory(server)
  await startFiles(files)
  return files
}

export async function mountMentionField(
  options: {
    tree?: readonly FileEntry[] | null
    value?: string
    /** The real store of the files, in place of the two plain states. */
    files?: ChatMentions['files']
  } = {},
) {
  const fake = new FakeFiles(
    options.tree === undefined ? sampleTree : options.tree,
  )
  const files = options.files ?? fake
  const opened: string[] = []
  const shown: string[] = []
  const counts = { sends: 0 }
  const mentions: ChatMentions = {
    files,
    openFile: (path) => opened.push(path),
    showFolder: (path) => shown.push(path),
    href: (item) => `/files/${item.path}`,
  }
  function Field() {
    const [host, setHost] = useState<HTMLDivElement | null>(null)
    const [text, setText] = useState(options.value ?? '')
    return (
      <LinksProvider value={{ links: { orgId: FAKE_IDS.org, workspaces: [] } }}>
        <MentionsProvider value={mentions}>
          <div data-host="" ref={setHost} />
          <ChipTextField
            label="Message"
            lines={2}
            maxLines={8}
            mentionHost={host}
            onChangeText={setText}
            onEnter={(event) => {
              if (event.shiftKey) return false
              event.preventDefault()
              counts.sends += 1
              return true
            }}
            owner="draft"
            placeholder="Message the agent"
            value={text}
          />
          <output>{text}</output>
        </MentionsProvider>
      </LinksProvider>
    )
  }
  const { container } = await mount(<Field />)
  const field = byRole('textbox', 'Message', container)
  // The box of the list: its line, or the listbox of its rows.
  const list = () => container.querySelector('#file-mention-list')
  return {
    field,
    files,
    opened,
    shown,
    sends: () => counts.sends,
    draft: () => container.querySelector('output')?.textContent,
    /** The list sits in the host above the box, or null while it is closed. */
    inHost: () => list()?.parentElement?.hasAttribute('data-host') ?? false,
    rows: () =>
      Array.from(list()?.querySelectorAll('[role="option"]') ?? [], (row) =>
        accessibleName(row),
      ),
    highlighted: () => {
      const row = list()?.querySelector('[aria-selected="true"]')
      return row ? accessibleName(row) : null
    },
    line: () => list()?.querySelector('[role="status"]')?.textContent ?? null,
    chips: () =>
      Array.from(field.querySelectorAll('[contenteditable="false"]'), (chip) =>
        accessibleName(chip),
      ),
    setTree: async (entries: readonly FileEntry[] | null) => {
      await act(async () => fake.set(entries))
    },
  }
}
