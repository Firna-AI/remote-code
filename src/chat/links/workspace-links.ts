import type { Workspace } from '../../shared/generated/Workspace'
import { parseRoute, routes } from '../../app/router'

/** A part of the text of a message field: plain text, or a link. */
export type TextPart =
  | { kind: 'text'; text: string }
  | {
      kind: 'link'
      /** The web address of the link. */
      href: string
      /** The link as the text has it, such as a Markdown link. */
      source: string
    }

/** The workspaces whose links show as chips: the visible ones of one org. */
export interface WorkspaceLinks {
  orgId: string
  /**
   * The workspaces of the org that the reader may see, with the archived
   * ones, or null while they load.
   */
  workspaces: readonly Workspace[] | null
}

/** The workspace that a link names, and the page of the app that it opens. */
export interface LinkTarget {
  workspace: Workspace
  /** The path, the query, and the hash of the page, as the router reads them. */
  to: string
  /** The session of a session link, or null for another page of the workspace. */
  sessionId: string | null
}

/** The target of a Markdown link: a web address, which can stand in angle brackets. */
const markdownTarget = /\(<?(https?:\/\/[^\s<>)`]+)>?\)/y

/**
 * A bare web address. It does not end with punctuation, so a full stop after
 * it stays text. A web address holds no backtick, so a backtick after it
 * ends it.
 */
const bareLink = /https?:\/\/[^\s<>`]*[^\s<>`.,;:!?'")\]]/y

/** A Markdown link with its label on one line, or a bare web address. */
const linkPattern = new RegExp(
  `\\[[^\\]\\n]*\\]${markdownTarget.source}|${bareLink.source}`,
  'g',
)

/**
 * The target of a Markdown link that starts at `at`, such as `(<address>)`:
 * its web address and its length, or null.
 */
export function markdownTargetAt(
  text: string,
  at: number,
): { href: string; length: number } | null {
  markdownTarget.lastIndex = at
  const match = markdownTarget.exec(text)
  return match ? { href: match[1] ?? '', length: match[0].length } : null
}

/** The bare web address that starts at `at`, or null. */
export function bareLinkAt(text: string, at: number): string | null {
  bareLink.lastIndex = at
  return bareLink.exec(text)?.[0] ?? null
}

/**
 * Splits the text of a message field into plain text and links. A message
 * field keeps plain text, so it reads no code: a link in backticks counts.
 */
export function textParts(text: string): TextPart[] {
  const parts: TextPart[] = []
  let end = 0
  for (const match of text.matchAll(linkPattern)) {
    if (match.index > end) {
      parts.push({ kind: 'text', text: text.slice(end, match.index) })
    }
    parts.push({ kind: 'link', href: match[1] ?? match[0], source: match[0] })
    end = match.index + match[0].length
  }
  if (end < text.length) parts.push({ kind: 'text', text: text.slice(end) })
  return parts
}

/** The origin of a link, such as the link of a workspace, or null. */
export function originOf(link: string): string | null {
  try {
    return new URL(link).origin
  } catch {
    return null
  }
}

/**
 * Whether a link reads as a page of a workspace of the org, whatever list
 * the reader has. Such a link can become a chip once the list holds its
 * workspace.
 */
export function namesOrgWorkspace(href: string, orgId: string): boolean {
  try {
    const url = new URL(href)
    const route = parseRoute(url.pathname, url.search)
    return route.screen === 'workspace' && route.orgId === orgId
  } catch {
    return false
  }
}

/**
 * The workspace that a link names, or undefined. The URL parser resolves the
 * link as a browser does, so a link with `..` names the workspace whose page
 * it opens. The link must have the origin of the workspace links, and the
 * router must read a page of one workspace of the org, which can be one of
 * its tabs. Only a workspace in the list matches. So a link to another org,
 * or to a workspace that the reader may not see, names none.
 */
export function linkTarget(
  href: string,
  links: WorkspaceLinks,
): LinkTarget | undefined {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return undefined
  }
  const route = parseRoute(url.pathname, url.search)
  if (route.screen !== 'workspace' || route.orgId !== links.orgId) {
    return undefined
  }
  const workspace = links.workspaces?.find(
    (item) => item.id === route.workspaceId,
  )
  if (!workspace || originOf(workspace.link) !== url.origin) return undefined
  return {
    workspace,
    to: `${url.pathname}${url.search}${url.hash}`,
    sessionId: route.session ?? null,
  }
}

/**
 * The target of a session that the chat names by its IDs, such as the
 * session whose agent stopped a turn: the target of the link of that
 * session. Only a workspace in the list matches, as for `linkTarget`.
 */
export function sessionTarget(
  session: { workspaceId: string; sessionId: string },
  links: WorkspaceLinks,
): LinkTarget | undefined {
  const workspace = links.workspaces?.find(
    (item) => item.id === session.workspaceId,
  )
  if (!workspace) return undefined
  return {
    workspace,
    to: routes.session(links.orgId, session.workspaceId, session.sessionId),
    sessionId: session.sessionId,
  }
}
