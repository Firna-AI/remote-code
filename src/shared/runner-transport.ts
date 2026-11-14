/** Socket contracts for the Worker's in-memory runner test endpoint. */

import type { RunnerToWorkspace } from './generated/RunnerToWorkspace'
import type { WorkspaceToRunner } from './generated/WorkspaceToRunner'
export interface RunnerConnection<
  Message extends WorkspaceToRunner = WorkspaceToRunner,
> {
  send(message: RunnerToWorkspace): void
  onMessage(listener: (message: Message) => void): () => void
  onClose(listener: () => void): () => void
  close(): void
}

export interface RunnerConnectionRequest {
  url: string
  workspaceToken: string
}

export type RunnerConnector<
  Message extends WorkspaceToRunner = WorkspaceToRunner,
> = (
  request: RunnerConnectionRequest,
) => RunnerConnection<Message> | Promise<RunnerConnection<Message>>
