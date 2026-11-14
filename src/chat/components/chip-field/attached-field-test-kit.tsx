import { act, useEffect, useState } from 'react'
import type { FileEntry } from '../../../shared/generated/FileEntry'
import { ApiError } from '../../../app/api/client'
import type { DraftFile } from '../../../app/draft-files'
import { attachmentPath } from '../../../shared/attachment-paths'
import { accessibleName, byRole } from '../../../test-support/dom-queries'
import { FAKE_IDS } from '../../../test-support/fixtures/core'
import { mount } from '../../../test-support/mount'
import { LinksProvider } from '../../links/LinksContext'
import {
  MentionsProvider,
  type ChatMentions,
} from '../../mentions/MentionsContext'
import type { FieldFiles } from './attached-files'
import { ChipTextField } from './ChipTextField'
import type { FieldHandle } from './focus-plugins'
import { FakeFiles } from './mention-field-test-kit'

// Mounts the message field with the attached files of its draft, as a
// composer does, and with the files of its workspace when a test gives a
// tree, as the chat composer does. `attached-field-events.ts` drives its
// clipboard, its drags, and the layout of a point.

/** The files of a draft, as the store of its owner keeps them. */
class DraftFilesStore implements FieldFiles {
  private items: readonly DraftFile[]
  private readonly listeners = new Set<() => void>()
  /** The ID of each file that Try again asked to upload again. */
  readonly retried: string[] = []

  constructor(items: readonly DraftFile[]) {
    this.items = items
  }

  files = () => this.items

  retry = (id: string) => {
    this.retried.push(id)
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Gives the draft these files, as an attach, an upload, or an end does. */
  set(items: readonly DraftFile[]) {
    this.items = items
    this.listeners.forEach((listener) => listener())
  }
}

function bytes(name: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type: 'image/png' })
}

/** A file of a draft whose upload is ready, with its copy path. */
export async function readyFile(
  id: string,
  name: string,
  size = 2048,
): Promise<Extract<DraftFile, { state: 'ready' }>> {
  const attachmentId = `attachment-${id}`
  const path = await attachmentPath({ id: attachmentId, name })
  const attachment = {
    id: attachmentId,
    name,
    path,
    kind: 'image' as const,
    mediaType: 'image/png',
    sizeBytes: size,
  }
  return { state: 'ready', id, file: bytes(name, size), attachment }
}

/** A file of a draft whose upload runs, with the bytes that it sent. */
export function uploadingFile(
  id: string,
  name: string,
  sentBytes: number | null,
  size = 2048,
): DraftFile {
  return { state: 'uploading', id, file: bytes(name, size), sentBytes }
}

/** A file of a draft whose upload failed. */
export function failedFile(id: string, name: string, size = 2048): DraftFile {
  const error = new ApiError(500, 'upload_failed', 'The upload failed.')
  return { state: 'failed', id, file: bytes(name, size), error }
}

/**
 * The workspaces of the org, the same at each render, as the store of the
 * app gives them. A new list at each render would make the field bring its
 * chips in line with it after each change.
 */
const links = { orgId: FAKE_IDS.org, workspaces: [] }

/**
 * The files of the workspace, which the list of `@` offers and the file
 * chips find, or null for a field that takes no mentions, such as the
 * message of New workspace.
 */
function mentionsOf(tree: readonly FileEntry[] | undefined) {
  if (tree === undefined) return null
  const mentions: ChatMentions = {
    files: new FakeFiles(tree),
    openFile: () => undefined,
    showFolder: () => undefined,
    href: (item) => `/files/${item.path}`,
  }
  return mentions
}

/** What a test changes of the owner of the field. */
interface Owner {
  /** Gives the draft a new text, such as a draft that comes back. */
  setValue: (text: string) => void
  /** Shows another draft, with its own identity. */
  show: (id: string, text: string) => void
  setEditable: (editable: boolean) => void
}

export async function mountAttachedField(
  options: {
    value?: string
    files?: readonly DraftFile[]
    tree?: readonly FileEntry[]
  } = {},
) {
  const store = new DraftFilesStore(options.files ?? [])
  const mentions = mentionsOf(options.tree)
  const handle: { current: FieldHandle | null } = { current: null }
  const control: { owner: Owner | null } = { owner: null }
  const counts = { sends: 0 }
  function Field() {
    const [draft, setDraft] = useState({
      id: 'draft:first',
      text: options.value ?? '',
    })
    const [editable, setEditable] = useState(true)
    useEffect(() => {
      control.owner = {
        setValue: (text) => setDraft((now) => ({ ...now, text })),
        show: (id, text) => setDraft({ id, text }),
        setEditable,
      }
    }, [])
    return (
      <LinksProvider value={{ links }}>
        <MentionsProvider value={mentions}>
          <ChipTextField
            editable={editable}
            files={store}
            handle={handle}
            label="Message"
            lines={2}
            maxLines={8}
            onChangeText={(text) => setDraft((now) => ({ ...now, text }))}
            onEnter={(event) => {
              event.preventDefault()
              counts.sends += 1
              return true
            }}
            owner={draft.id}
            placeholder="Message the agent"
            value={draft.text}
          />
          <output>{draft.text}</output>
        </MentionsProvider>
      </LinksProvider>
    )
  }
  const { container } = await mount(<Field />)
  const field = byRole('textbox', 'Message', container)
  return {
    field,
    store,
    /** The handle of the field, as its composer holds it. */
    handle: () => {
      if (!handle.current) throw new Error('The field has no handle.')
      return handle.current
    },
    /** The text of the draft, as the owner of the field keeps it. */
    draft: () => container.querySelector('output')?.textContent,
    chips: () =>
      Array.from(field.querySelectorAll('[contenteditable="false"]'), (chip) =>
        accessibleName(chip),
      ),
    sends: () => counts.sends,
    /** A change of the owner, and the work of the field that follows it. */
    set: async (change: (owner: Owner) => void) => {
      const { owner } = control
      if (!owner) throw new Error('The owner of the field has not mounted.')
      await act(async () => change(owner))
    },
  }
}
