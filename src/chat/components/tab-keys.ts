import type { TranscriptDetail } from '../../shared/generated/TranscriptDetail'
import { stepShortcutItem } from '../../app/shortcuts/navigation'

import { useShortcutOffer } from '../../shell/shortcuts/shortcut-context'
import type { ChatController } from '../state/controller'
import type { MenuEntry } from '../ui/Menu'
import type { RowTab } from './tab-row'

/** Shows a tab of the row, as a press on it does. */
function showTab(tab: RowTab, controller: ChatController): () => void {
  return tab.kind === 'session'
    ? () => void controller.select(tab.id)
    : () => tab.show()
}

/**
 * The keys of the tab row while the chat shows it, as the protocol of the
 * keys says. Previous tab and Next tab show the tab before or after the
 * shown tab, with a wrap at each end. Close tab closes the shown session
 * tab as its Close does, and the host gives the key to a shown file tab.
 * Reopen closed session runs the first row of the session history, which
 * lists the session that closed last first. Copy concise transcript and
 * Copy full transcript copy the shown session as the items of its tab menu
 * do, with the same toast. While a file tab shows, they do not run.
 */
export function useTabKeys(props: {
  tabs: readonly RowTab[]
  controller: ChatController
  history: readonly MenuEntry[]
  /** Copies the transcript of a session, as the items of its tab menu do. */
  copy: (sessionId: string, detail: TranscriptDetail) => void
}): void {
  const { tabs, controller, copy } = props
  const shown = tabs.find((tab) => tab.selected)
  const step = (direction: -1 | 1) => {
    const next = shown && stepShortcutItem(tabs, shown, direction)
    return next && next !== shown ? showTab(next, controller) : null
  }
  useShortcutOffer('previous-tab', step(-1))
  useShortcutOffer('next-tab', step(1))
  useShortcutOffer(
    'close-tab',
    shown?.kind === 'session'
      ? () => void controller.requestClose(shown.id)
      : null,
  )
  const last = props.history.find((entry) => entry.kind === 'item')
  useShortcutOffer(
    'reopen-session',
    last?.kind === 'item' ? last.onSelect : null,
  )
  const copyOf = (detail: TranscriptDetail) =>
    shown?.kind === 'session' ? () => copy(shown.id, detail) : null
  useShortcutOffer('copy-concise-transcript', copyOf('concise'))
  useShortcutOffer('copy-full-transcript', copyOf('full'))
}
