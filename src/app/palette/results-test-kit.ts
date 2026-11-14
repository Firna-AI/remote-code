import type { Workspace } from '../../shared/generated/Workspace'

import { coreFixtures, FAKE_ORIGIN } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { routes } from '../router'
import { ready } from '../store'
import type { PaletteResults } from './palette-results'
import type { PaletteRow } from './palette-rows'
import type { PaletteQuery, PaletteSource } from './palette-source'
import { nameLabel } from '../../shared/name-label'

// The data of the tests of the palette results: Acme of the fake API.

const core = coreFixtures()
const orgs = core.orgs.orgs
export const [acme, futex, firna] = orgs
export const sections = core.sectionList.sections
const repositories = core.repositories.repositories
export const workspaces = workspaceFixtures().workspaces.workspaces

/** The sections of the Account page outside the Mac app, then Keyboard shortcuts. */
export const accountRows = [
  'Sign-in',
  'GitHub',
  'Agents',
  'New workspaces',
  'Keyboard shortcuts',
]

/** What the palette reads on the list of Acme, with the overrides. */
export function source(overrides: Partial<PaletteSource> = {}): PaletteSource {
  return {
    orgs,
    org: acme,
    suspended: false,
    list: ready({ sections, workspaces }),
    repositories: ready(repositories),
    openWorkspaceId: null,
    createOrgHref: routes.createOrg(),
    orgHref: routes.org,
    offers: [],
    mac: false,
    ...overrides,
  }
}

/** The All tab with an empty field, with the overrides. */
export function query(overrides: Partial<PaletteQuery> = {}): PaletteQuery {
  return {
    tab: 'all',
    text: '',
    repositoryId: null,
    archived: false,
    ...overrides,
  }
}

function label(row: PaletteRow): string {
  if (row.kind === 'workspace') {
    const name = nameLabel(row.workspace.name)
    return row.numberLabel ? `${row.numberLabel} ${name}` : name
  }
  return row.detail ? `${row.label} · ${row.detail}` : row.label
}

/**
 * Each group as its label and the labels of its rows. A workspace row that
 * shows the label of its number starts with it, as the palette draws it.
 */
export function shown(results: PaletteResults): [string, string[]][] {
  return results.groups.map((group) => [group.label, group.rows.map(label)])
}

/** A workspace of Acme beside the fixtures. */
export function extra(
  fields: Partial<Workspace> & Pick<Workspace, 'id' | 'name'>,
): Workspace {
  return {
    ...workspaces[0],
    branch: `calummoore/${fields.id}`,
    ...fields,
    link: new URL(
      routes.workspace(fields.orgId ?? workspaces[0].orgId, fields.id),
      FAKE_ORIGIN,
    ).href,
  }
}
