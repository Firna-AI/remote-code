import { agentWorkspacePath } from './agent-workspaces.ts'

export function agentPreviewsPath(workspaceId?: string): string {
  return `${agentWorkspacePath(workspaceId)}/previews`
}

export function agentPreviewClosePath(
  workspaceId: string | undefined,
  previewId: string,
): string {
  return `${agentPreviewsPath(workspaceId)}/${encodeURIComponent(previewId)}/close`
}
