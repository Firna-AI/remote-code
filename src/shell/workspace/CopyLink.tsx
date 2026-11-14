import type { Workspace } from '../../shared/generated/Workspace'
import { useEffect, useRef, useState } from 'react'
import {
  CopyLinkButton,
  type CopyResult,
} from '../../../docs/mockups/src/components/workspace/CopyLinkButton'
import { workspaceLabel } from '../../../docs/mockups/src/components/workspaces/label'
import { useServices } from '../../app/services'

import { useShortcutOffer } from '../shortcuts/shortcut-context'
import {
  ShortcutTip,
  useAriaShortcut,
  useShortcutHint,
} from '../shortcuts/shortcut-hints'

/** How long the note says that the link was copied, in ms. */
const copiedMs = 2_000

/**
 * The label of the number of the workspace, such as `W-395`, as the button
 * that copies the link of the workspace. The link holds no tab path. After a
 * press, the note under the button says "Link copied" for a moment. A copy
 * that fails says to try again until the next press, as the file page does.
 * The note is a status, and it lies over the content, so nothing moves. The
 * header gives each workspace its own button, so a note never outlives the
 * workspace that it names. The key of Copy link does what a press does
 * while the button shows. Its tooltip names that key, and the button names
 * it to a screen reader.
 */
export function CopyLink(props: { workspace: Workspace; inline: boolean }) {
  const services = useServices()
  const hint = useShortcutHint('copy-link')
  const nameKey = useAriaShortcut(hint)
  const [result, setResult] = useState<CopyResult | undefined>(undefined)
  const press = useRef(0)
  const clear = useRef<(() => void) | null>(null)
  useEffect(
    () => () => {
      // A copy that ends after the button goes shows nothing.
      press.current += 1
      clear.current?.()
    },
    [],
  )
  const copy = () => {
    const current = ++press.current
    clear.current?.()
    clear.current = null
    setResult(undefined)
    const show = (next: CopyResult) => {
      if (press.current !== current) return
      setResult(next)
      if (next === 'copied') {
        clear.current = services.delay(copiedMs, () => {
          if (press.current === current) setResult(undefined)
        })
      }
    }
    services.copy(props.workspace.link).then(
      () => show('copied'),
      () => show('failed'),
    )
  }
  useShortcutOffer('copy-link', copy)
  const label = workspaceLabel(props.workspace.number)
  return (
    <ShortcutTip hint={hint} label={`Copy link to ${label}`}>
      <CopyLinkButton
        buttonRef={nameKey}
        inline={props.inline}
        label={label}
        onPress={copy}
        result={result}
      />
    </ShortcutTip>
  )
}
