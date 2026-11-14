import { MACHINE_PATHS } from './agent-tools.ts'

export function agentWorkspacePath(workspaceId = 'current'): string {
  return `${MACHINE_PATHS.workspaces}/${encodeURIComponent(workspaceId)}`
}

export const agentWorkspacePaths = {
  rename: (id?: string) => `${agentWorkspacePath(id)}/rename`,
  move: (id?: string) => `${agentWorkspacePath(id)}/move`,
  archive: (id?: string) => `${agentWorkspacePath(id)}/archive`,
} as const
