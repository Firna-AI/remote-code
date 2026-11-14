import type { AgentListModelsResponse } from '../../src/shared/generated/AgentListModelsResponse'
import type { AgentListRepositoriesResponse } from '../../src/shared/generated/AgentListRepositoriesResponse'
import type { AgentListSectionsResponse } from '../../src/shared/generated/AgentListSectionsResponse'
import type { AgentListWorkspacesResponse } from '../../src/shared/generated/AgentListWorkspacesResponse'
import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import { MACHINE_PATHS } from '../../src/shared/agent-tools'

import { sectionToolMethods } from './section-routes'
import { previewToolMethods } from './preview-routes'
import { listToolWorkspaces } from './workspace-data'
import { workspaceToolMethods } from './workspace-routes'
import { workspaceListInput } from './workspace-input'
import { HttpError } from '../http'
import { readImageRepositories } from '../lifecycle/published-image-data'
import type { AgentToolServices } from './services'
import { isAgentSessionPath } from './session-routes'
import { type CallingWorkspace, orgSections, ownerPreference } from './store'

export function isAgentToolPath(path: string): boolean {
  return (
    sectionToolMethods(path) !== null ||
    previewToolMethods(path) !== null ||
    workspaceToolMethods(path) !== null ||
    isAgentSessionPath(path) ||
    [
      MACHINE_PATHS.workspaces,
      MACHINE_PATHS.repositories,
      MACHINE_PATHS.sections,
      MACHINE_PATHS.models,
    ].some((toolPath) => toolPath === path)
  )
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

async function defaultChoice(
  db: D1Database,
  caller: CallingWorkspace,
  services: AgentToolServices,
): Promise<AgentChoice | null> {
  const preference = await ownerPreference(db, caller.ownerUserId)
  if (preference) return { ...preference, fast: false }
  try {
    const selected = await services.ownerDefaultChoice?.(caller.ownerUserId)
    return selected ? { ...selected, fast: false } : null
  } catch (error) {
    if (
      error instanceof HttpError &&
      error.code === 'default_model_unavailable'
    )
      return null
    throw error
  }
}

export async function listFromTool(
  url: URL,
  db: D1Database,
  caller: CallingWorkspace,
  services: AgentToolServices,
  origin: string,
): Promise<
  | AgentListWorkspacesResponse
  | AgentListRepositoriesResponse
  | AgentListSectionsResponse
  | AgentListModelsResponse
> {
  switch (url.pathname) {
    case MACHINE_PATHS.repositories: {
      const repositories = await readImageRepositories(db, caller.orgId)
      repositories.sort(
        (a, b) =>
          compareText(a.fullName.toLowerCase(), b.fullName.toLowerCase()) ||
          compareText(a.fullName, b.fullName) ||
          compareText(a.id, b.id),
      )
      return {
        repositories: repositories.map(({ id, fullName, defaultBranch }) => ({
          id,
          fullName,
          defaultBranch,
          current: id === caller.repositoryId,
        })),
      }
    }
    case MACHINE_PATHS.sections:
      return { sections: await orgSections(db, caller.orgId) }
    case MACHINE_PATHS.models:
      return {
        models: (await services.models()).map((model) => ({
          ...model,
          fast: model.fast === true,
        })),
        defaultChoice: await defaultChoice(db, caller, services),
      }
    default:
      return listToolWorkspaces(
        db,
        caller.orgId,
        origin,
        workspaceListInput(url.searchParams),
      )
  }
}
