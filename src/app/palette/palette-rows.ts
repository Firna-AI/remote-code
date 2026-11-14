import type { Workspace } from '../../shared/generated/Workspace'
import { workspaceLabel } from '../../../docs/mockups/src/components/workspaces/label'
import type { OrgSummary } from '../../shared/orgs'
import type { ShortcutCommandId } from '../../shared/shortcut-commands'

import { routes, type AccountTab, type SettingsTab } from '../router'
import {
  accountSettingIds,
  accountSettings,
  actionCommands,
  actionTexts,
  orgSettings,
  type AccountSettingId,
  type OfferedActionId,
  type OwnActionId,
} from './commands'
import { matchRank } from './matcher'
import type { OfferedAction } from './page-actions'
import { nameLabel } from '../../shared/name-label'

/** A workspace of the org. It opens the workspace. */
export interface WorkspaceRow {
  readonly kind: 'workspace'
  readonly key: string
  readonly workspace: Workspace
  /** The repository of the workspace, or empty while it is unknown. */
  readonly repository: string
  /**
   * The label of the number, such as `W-395`, which the row shows before
   * the name while a word of the query is in that label.
   */
  readonly numberLabel?: string
  readonly href: string
}

/** What leads a command row: the icon of an action or a setting, or an org. */
export type CommandLead =
  | { readonly kind: 'action'; readonly id: OfferedActionId | OwnActionId }
  | { readonly kind: 'org'; readonly org: OrgSummary }
  | { readonly kind: 'org-setting'; readonly tab: SettingsTab }
  | { readonly kind: 'account'; readonly id: AccountSettingId }

/**
 * An action or a setting. A row with `href` is a link to a page. A plain
 * click and Enter run `run` when the row has one, and open `href` when not.
 */
export interface CommandRow {
  readonly kind: 'command'
  readonly key: string
  readonly lead: CommandLead
  readonly label: string
  readonly words: readonly string[]
  /** The page that holds a setting, in a list of several kinds. */
  readonly detail?: string
  readonly href?: string
  readonly run?: () => void
  /** The command of the keys that does what the row does, whose key it shows. */
  readonly command?: ShortcutCommandId
}

export type PaletteRow = WorkspaceRow | CommandRow

export interface PaletteGroup {
  readonly label: string
  readonly rows: readonly PaletteRow[]
}

/**
 * The texts that a search looks at in a row. The label of the number of a
 * workspace is one more text, with the same rules as its name.
 */
export function rowTexts(row: PaletteRow): readonly string[] {
  if (row.kind === 'workspace') {
    const { workspace } = row
    return [
      nameLabel(workspace.name),
      workspaceLabel(workspace.number),
      workspace.branch,
      row.repository,
    ]
  }
  return [row.label, ...row.words]
}

/**
 * The row as a search for the words shows it. A workspace row shows the
 * label of its number when one of the words is in that label, by the rule
 * of the search. Every other row stays as it is.
 */
export function withNumberLabel(
  row: PaletteRow,
  words: readonly string[],
): PaletteRow {
  if (row.kind !== 'workspace') return row
  const label = workspaceLabel(row.workspace.number)
  const matched = words.some((word) => matchRank([word], [label]) !== null)
  return matched ? { ...row, numberLabel: label } : row
}

/** The names of the repositories of the org, by their ID. */
export type RepositoryNames = ReadonlyMap<string, string>

export function workspaceRow(
  workspace: Workspace,
  names: RepositoryNames,
): WorkspaceRow {
  return {
    kind: 'workspace',
    key: `workspace:${workspace.id}`,
    workspace,
    repository: names.get(workspace.repositoryId) ?? '',
    href: routes.workspace(workspace.orgId, workspace.id),
  }
}

/** The command of a row, without the field when the row has none. */
function commandOf(command: ShortcutCommandId | null): {
  command?: ShortcutCommandId
} {
  return command === null ? {} : { command }
}

/** The row of an action that a part of the page offers. */
export function offeredRow(action: OfferedAction): CommandRow {
  const text = actionTexts[action.id]
  return {
    kind: 'command',
    key: `action:${action.id}`,
    lead: { kind: 'action', id: action.id },
    label: text.label,
    words: text.words,
    href: action.href,
    run: action.run,
    ...commandOf(actionCommands[action.id]),
  }
}

/** An action of the palette itself, which opens a page. */
export function linkRow(
  id: Exclude<OwnActionId, 'switch-org'>,
  href: string,
): CommandRow {
  const text = actionTexts[id]
  return {
    kind: 'command',
    key: `action:${id}`,
    lead: { kind: 'action', id },
    label: text.label,
    words: text.words,
    href,
    ...commandOf(actionCommands[id]),
  }
}

/**
 * Send feedback, which the palette offers on each page. It is not a link,
 * because the Feedback dialog has no address: the palette opens the dialog
 * over the current page.
 */
export function feedbackRow(): CommandRow {
  const text = actionTexts['send-feedback']
  return {
    kind: 'command',
    key: 'action:send-feedback',
    lead: { kind: 'action', id: 'send-feedback' },
    label: text.label,
    words: text.words,
    ...commandOf(actionCommands['send-feedback']),
  }
}

/**
 * Switch to another org of the person. It opens `href`: the last workspace
 * of the org, or else its list page, as the tile of the org does.
 * `command` is Switch to org 1 to 9 of the place of the org in the rail.
 */
export function switchRow(
  org: OrgSummary,
  command: ShortcutCommandId | null,
  href: string,
): CommandRow {
  const text = actionTexts['switch-org']
  return {
    kind: 'command',
    key: `switch:${org.id}`,
    lead: { kind: 'org', org },
    label: `${text.label} ${org.name}`,
    words: text.words,
    href,
    ...commandOf(command),
  }
}

/** The name of the group of the settings of an org, such as "Acme settings". */
export function orgSettingsLabel(org: OrgSummary): string {
  return `${org.name} settings`
}

/** The label of the group of the sections of the Account page. */
export const accountLabel = 'Account'

/** The tabs of the settings of an org. Each row opens its tab. */
export function orgSettingRows(
  org: OrgSummary,
  withDetail: boolean,
): CommandRow[] {
  return orgSettings.map((setting) => ({
    kind: 'command',
    key: `setting:${setting.tab}`,
    lead: { kind: 'org-setting', tab: setting.tab },
    label: setting.label,
    words: setting.words,
    detail: withDetail ? orgSettingsLabel(org) : undefined,
    href: routes.settings(org.id, setting.tab),
    ...commandOf(
      setting.tab === 'repositories' ? 'repositories-settings' : null,
    ),
  }))
}

/** The tab of the Account page that holds a section, or that a row is. */
function accountTabOf(id: AccountSettingId): AccountTab {
  if (id === 'agents') return 'agents'
  if (id === 'new-workspaces') return 'preferences'
  if (id === 'keyboard-shortcuts') return 'shortcuts'
  if (id === 'this-mac') return 'this-mac'
  return 'general'
}

/**
 * The sections of the Account page, then its Keyboard shortcuts tab, then
 * its This Mac tab in the Mac app. Each row opens the tab that holds it.
 * Keyboard shortcuts runs the command of the keys that opens the tab, whose
 * key it shows.
 */
export function accountRows(mac: boolean, withDetail: boolean): CommandRow[] {
  return accountSettingIds
    .filter((id) => mac || id !== 'this-mac')
    .map((id) => ({
      kind: 'command',
      key: `account:${id}`,
      lead: { kind: 'account', id },
      label: accountSettings[id].label,
      words: accountSettings[id].words,
      detail: withDetail ? accountLabel : undefined,
      href: routes.accountTab(accountTabOf(id)),
      ...commandOf(id === 'keyboard-shortcuts' ? 'keyboard-shortcuts' : null),
    }))
}
