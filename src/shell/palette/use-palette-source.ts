import type { Workspace } from '../../shared/generated/Workspace'
import { useEffect } from 'react'
import { inFirstRun } from '../../app/get-started'
import type { ListData } from '../../app/list-changes'
import { useRoute } from '../../app/navigation'
import { paletteOrg } from '../../app/palette/palette-org'
import type {
  PaletteBase,
  PaletteRead,
  PaletteSource,
} from '../../app/palette/palette-source'
import { isSuspended } from '../../app/permissions'
import { routes } from '../../app/router'
import {
  loading,
  ready,
  useStore,
  type Loadable,
  type Readable,
} from '../../app/store'
import type { Section } from '../../shared/sections'

import { useApp } from '../context'
import { useMacApp } from '../mac/mac-app'
import { useOrgEntry } from '../orgs/useOrgEntry'
import { usePalette } from './palette-context'

/** The parts of an org that a palette without an org does not read. */
const nothing: Readable<Loadable<never>> = {
  get: () => loading,
  subscribe: () => () => undefined,
}

function listOf(
  sections: Loadable<readonly Section[]>,
  workspaces: Loadable<readonly Workspace[]>,
): Loadable<ListData> {
  if (sections.state === 'failed') return sections
  if (workspaces.state === 'failed') return workspaces
  if (sections.state === 'loading' || workspaces.state === 'loading') {
    return loading
  }
  return ready({ sections: sections.value, workspaces: workspaces.value })
}

/**
 * What the actions and the settings of the palette read from the app: the
 * org of the palette, the orgs of the person, the open workspace, and what
 * the parts of the page offer. The keys of their commands read it too,
 * while the palette is closed, so it reads no part of the org.
 */
export function usePaletteBase(): PaletteBase {
  const app = useApp()
  const route = useRoute()
  const orgs = useStore(app.orgs)
  const refused = useStore(app.refusedOrgs)
  const lastOrg = useStore(app.lastOrg)
  const getStarted = useStore(app.getStarted)
  const offers = useStore(usePalette().offers)
  const mac = useMacApp() !== null
  const orgHref = useOrgEntry()
  const org = paletteOrg(route, orgs, lastOrg)
  const open =
    route.screen === 'workspace' && route.orgId === org?.id
      ? route.workspaceId
      : null
  return {
    orgs,
    org,
    suspended: org !== null && isSuspended(org, refused),
    openWorkspaceId: open,
    createOrgHref: inFirstRun(getStarted)
      ? routes.getStarted()
      : routes.createOrg(),
    orgHref,
    offers,
    mac,
  }
}

/**
 * What the open palette reads from the app: its base, and the list and the
 * repositories of its org, which it reads while it is open. `retry` reads
 * the given parts of the org again, such as the reads that failed.
 */
export function usePaletteSource(): {
  source: PaletteSource
  retry: (reads: readonly PaletteRead[]) => Promise<void>
} {
  const app = useApp()
  const base = usePaletteBase()
  const model = base.org === null ? null : app.org(base.org.id)
  const sections = useStore(model?.sections ?? nothing)
  const workspaces = useStore(model?.workspaces ?? nothing)
  const repositories = useStore(model?.repositories ?? nothing)
  useEffect(() => model?.watch('list', 'repositories'), [model])
  return {
    source: {
      ...base,
      list: listOf(sections, workspaces),
      repositories,
    },
    retry: async (reads) => {
      if (model === null) return
      await Promise.all(reads.map((read) => model.reload(read)))
    },
  }
}
