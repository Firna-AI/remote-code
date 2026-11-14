import type { Workspace } from '../shared/generated/Workspace'
import type { Section } from '../shared/sections'

export interface SectionGroup {
  section: Section
  workspaces: readonly Workspace[]
}

export interface WorkspaceGroups {
  sections: readonly SectionGroup[]
  /** The Archived group at the end of the list, the last archived first. */
  archived: readonly Workspace[]
}

/** The default section, General, where new workspaces go. */
export function defaultSection(
  sections: readonly Section[],
): Section | undefined {
  return sections.find((section) => section.isDefault) ?? sections[0]
}

function ordered(sections: readonly Section[]): Section[] {
  return [...sections].sort((a, b) => a.position - b.position)
}

/** The section that shows a workspace. An unknown section falls back to General. */
function sectionOf(
  workspace: Workspace,
  sections: readonly Section[],
  fallback: Section | undefined,
): string | undefined {
  return sections.some((section) => section.id === workspace.sectionId)
    ? workspace.sectionId
    : fallback?.id
}

/**
 * The sections of the list, each with its workspaces in the order of the
 * workspace list. Archived workspaces leave their sections for the
 * Archived group.
 */
export function groupWorkspaces(
  sections: readonly Section[],
  workspaces: readonly Workspace[],
): WorkspaceGroups {
  const fallback = defaultSection(sections)
  const live = workspaces.filter((workspace) => workspace.state !== 'archived')
  return {
    sections: ordered(sections).map((section) => ({
      section,
      workspaces: live.filter(
        (workspace) => sectionOf(workspace, sections, fallback) === section.id,
      ),
    })),
    archived: workspaces
      .filter((workspace) => workspace.state === 'archived')
      .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)),
  }
}

/**
 * The list after a drag puts a workspace at `index` of a section. The index
 * counts the workspaces of that section without the moved one. Every other
 * workspace keeps its place.
 */
export function moveWorkspace(
  workspaces: readonly Workspace[],
  sections: readonly Section[],
  workspaceId: string,
  sectionId: string,
  index: number,
): Workspace[] {
  const moved = workspaces.find((workspace) => workspace.id === workspaceId)
  if (!moved) return [...workspaces]
  const fallback = defaultSection(sections)
  const rest = workspaces.filter((workspace) => workspace.id !== workspaceId)
  const target = rest.filter(
    (workspace) =>
      workspace.state !== 'archived' &&
      sectionOf(workspace, sections, fallback) === sectionId,
  )
  const placed = { ...moved, sectionId }
  const before = target[Math.max(0, index)]
  if (before) {
    const at = rest.indexOf(before)
    return [...rest.slice(0, at), placed, ...rest.slice(at)]
  }
  const last = target.at(-1)
  if (!last) return [placed, ...rest]
  const at = rest.indexOf(last) + 1
  return [...rest.slice(0, at), placed, ...rest.slice(at)]
}

/**
 * The sections after a move puts one at `index` of the list. The index
 * counts the sections without the moved one. Each section then takes its
 * place as its position, as the server numbers them.
 */
export function reorderSections(
  sections: readonly Section[],
  sectionId: string,
  index: number,
): Section[] {
  const list = ordered(sections)
  const moved = list.find((section) => section.id === sectionId)
  if (!moved) return list
  const rest = list.filter((section) => section !== moved)
  const at = Math.min(Math.max(0, index), rest.length)
  return [...rest.slice(0, at), moved, ...rest.slice(at)].map(
    (section, position) => ({ ...section, position }),
  )
}

/** Deleting a section moves its workspaces to General, so nothing is lost. */
export function withoutSection(
  sections: readonly Section[],
  workspaces: readonly Workspace[],
  sectionId: string,
): { sections: Section[]; workspaces: Workspace[] } {
  const left = sections.filter((section) => section.id !== sectionId)
  const general = defaultSection(left)
  return {
    sections: left,
    workspaces: workspaces.map((workspace) =>
      workspace.sectionId === sectionId && general
        ? { ...workspace, sectionId: general.id }
        : workspace,
    ),
  }
}

/**
 * The place one step up or down from a workspace, for the keys that move a
 * row. A step past the end of a section goes to the next open section.
 */
export function stepTarget(
  groups: readonly SectionGroup[],
  workspaceId: string,
  step: 1 | -1,
): { sectionId: string; index: number } | null {
  const at = groups.findIndex((group) =>
    group.workspaces.some((workspace) => workspace.id === workspaceId),
  )
  const group = groups[at]
  if (!group) return null
  const index = group.workspaces.findIndex((item) => item.id === workspaceId)
  const next = index + step
  if (next >= 0 && next < group.workspaces.length) {
    return { sectionId: group.section.id, index: next }
  }
  const open = (candidate: SectionGroup | undefined) =>
    candidate !== undefined && !candidate.section.collapsed
  for (
    let other = at + step;
    other >= 0 && other < groups.length;
    other += step
  ) {
    const neighbour = groups[other]
    if (!open(neighbour)) continue
    return {
      sectionId: neighbour.section.id,
      index: step === 1 ? 0 : neighbour.workspaces.length,
    }
  }
  return null
}
