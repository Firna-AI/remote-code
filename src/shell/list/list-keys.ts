import type { Workspace } from '../../shared/generated/Workspace'
import { routes } from '../../app/router'
import { workspaceForShortcut } from '../../app/shortcuts/navigation'
import {
  shortcutDigits,
  type ShortcutCommandId,
} from '../../shared/shortcut-commands'

import {
  useShortcutOffers,
  type CommandOffer,
} from '../shortcuts/shortcut-context'
import { useGo } from '../ui/AppLink'

/** The commands of the keys that open a workspace of the list. */
const listCommands: readonly ShortcutCommandId[] = [
  ...shortcutDigits.map((digit) => `workspace-${digit}` as const),
  'previous-workspace',
  'next-workspace',
  'next-needs-input',
]

/**
 * Offers the keys of the workspace list while the page shows it: Open
 * workspace 1 to 9, Previous and Next workspace, and Next workspace that
 * needs input, which starts from the top on the list page. They count only
 * `shown`, the rows that the list shows in their order, without a
 * collapsed section or a closed Archived group. Each key opens its
 * workspace as the link of its row does. A key that would open no other
 * workspace is not offered, so it goes on to the page.
 */
export function useListKeys(props: {
  shown: readonly Workspace[]
  /** The open workspace, which Previous and Next start from. */
  selectedId: string | null
  /** The page shows this list, so it takes the keys. */
  offered: boolean
}): void {
  const go = useGo()
  const { shown, selectedId } = props
  const rows = shown.map((workspace) => ({
    id: workspace.id,
    needsInput: workspace.state === 'input',
  }))
  const offers: CommandOffer[] = props.offered
    ? listCommands.flatMap((command) => {
        const id = workspaceForShortcut(command, rows, selectedId ?? '')
        const target = shown.find((workspace) => workspace.id === id)
        if (target === undefined || target.id === selectedId) return []
        const to = routes.workspace(target.orgId, target.id)
        return [{ command, run: () => go(to) }]
      })
    : []
  useShortcutOffers(offers)
}
