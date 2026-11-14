import type { Workspace } from '../../src/shared/generated/Workspace'
import { routes } from '../../src/app/router'

/** Older saved records can omit workspace links and the GitHub summary. */
export type WorkspaceSnapshot = Omit<
  Workspace,
  'number' | 'link' | 'restoreUntil' | 'github'
> &
  Partial<Pick<Workspace, 'number' | 'link' | 'restoreUntil' | 'github'>>

export interface WorkspaceLinkContext {
  orgId: string
  workspaceId: string
  number: number
  origin: string
}

export function workspaceLink(
  origin: string,
  orgId: string,
  workspaceId: string,
): string {
  return new URL(routes.workspace(orgId, workspaceId), origin).href
}

export function presentWorkspace(
  snapshot: WorkspaceSnapshot,
  context: WorkspaceLinkContext,
): Workspace {
  return {
    ...snapshot,
    github: snapshot.github ?? null,
    restoreUntil: snapshot.restoreUntil ?? null,
    number: context.number,
    link: workspaceLink(context.origin, context.orgId, context.workspaceId),
  }
}
