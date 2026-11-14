import type { Workspace } from '../../../shared/generated/Workspace'
import { act, useEffect, useState } from 'react'

import { accessibleName, byRole } from '../../../test-support/dom-queries'
import { FAKE_IDS } from '../../../test-support/fixtures/core'
import { workspaceFixtures } from '../../../test-support/fixtures/workspaces'
import { mount } from '../../../test-support/mount'
import { LinksProvider } from '../../links/LinksContext'
import { ChipTextField } from './ChipTextField'

// Mounts the chip text field for its tests, with an owner that keeps the
// draft of each session, as the chat does.

export const listed = workspaceFixtures().workspaces.workspaces
export const linked = listed[0] as Workspace
export const chipName = `W-${linked.number} ${linked.name}, Starting`

/** A draft as a session holds it: its identity and its text. */
interface HeldDraft {
  id: string
  text: string
}

/** The draft of each session, and the session whose draft the field shows. */
interface Drafts {
  shown: string
  bySession: Readonly<Record<string, HeldDraft>>
}

/** The draft of a session. A session without one has an empty draft. */
function draftOf(drafts: Drafts, session: string): HeldDraft {
  return drafts.bySession[session] ?? { id: `draft:${session}`, text: '' }
}

function withDraft(drafts: Drafts, session: string, draft: HeldDraft): Drafts {
  return { ...drafts, bySession: { ...drafts.bySession, [session]: draft } }
}

function withText(drafts: Drafts, session: string, text: string): Drafts {
  return withDraft(drafts, session, { ...draftOf(drafts, session), text })
}

/** The owner of the field, which keeps the draft of each session. */
interface Owner {
  /** Gives the shown draft a new text, such as a draft that comes back. */
  setValue: (value: string) => void
  setList: (list: readonly Workspace[] | null) => void
  /** Shows the draft of another session, as a press on its tab does. */
  show: (session: string) => void
  /**
   * Moves the shown draft, with its identity, to another session, which then
   * shows. The old session gets a new empty draft, as in the chat.
   */
  moveTo: (session: string) => void
}

/** A text that the field gave, and the session whose callback took it. */
interface Change {
  session: string
  text: string
}

export async function mountField(
  options: {
    value?: string
    list?: readonly Workspace[] | null
    editable?: boolean
    caretAtEnd?: boolean
  } = {},
) {
  const control: { owner: Owner | null } = { owner: null }
  const changes: Change[] = []
  function Field() {
    const [drafts, setDrafts] = useState<Drafts>(() => ({
      shown: 'first',
      bySession: { first: { id: 'draft:first', text: options.value ?? '' } },
    }))
    const [list, setList] = useState(
      options.list === undefined ? listed : options.list,
    )
    useEffect(() => {
      control.owner = {
        setValue: (text) => setDrafts((now) => withText(now, now.shown, text)),
        setList,
        show: (session) => setDrafts((now) => ({ ...now, shown: session })),
        moveTo: (session) =>
          setDrafts((now) => {
            const fresh = { id: `fresh:${now.shown}`, text: '' }
            const moved = withDraft(now, session, draftOf(now, now.shown))
            return { ...withDraft(moved, now.shown, fresh), shown: session }
          }),
      }
    }, [])
    const { shown } = drafts
    const draft = draftOf(drafts, shown)
    const links = { orgId: FAKE_IDS.org, workspaces: list }
    return (
      <LinksProvider value={{ links }}>
        <ChipTextField
          caretAtEnd={options.caretAtEnd}
          editable={options.editable}
          label="Message"
          lines={2}
          maxLines={8}
          onChangeText={(text) => {
            changes.push({ session: shown, text })
            setDrafts((now) => withText(now, shown, text))
          }}
          owner={draft.id}
          placeholder="Message the agent"
          value={draft.text}
        />
        <output>{draft.text}</output>
      </LinksProvider>
    )
  }
  const { container } = await mount(<Field />)
  const field = byRole('textbox', 'Message', container)
  return {
    field,
    /** The field that the page shows now. It is `field` while that stays. */
    fieldNow: () => byRole('textbox', 'Message', container),
    /** The text of the draft that the field shows. */
    draft: () => container.querySelector('output')?.textContent,
    /** Each text that the field gave, with the session that took it. */
    changes,
    chips: () =>
      Array.from(field.querySelectorAll('[contenteditable="false"]'), (chip) =>
        accessibleName(chip),
      ),
    /** A change of the owner, and the work of the field that follows it. */
    set: async (change: (owner: Owner) => void) => {
      const { owner } = control
      if (!owner) throw new Error('The owner of the field has not mounted.')
      await act(async () => change(owner))
    },
  }
}
