import type { ChangesResponse } from '../../src/shared/generated/ChangesResponse'
import type { DiffResponse } from '../../src/shared/generated/DiffResponse'
import type { FileResponse } from '../../src/shared/generated/FileResponse'
import type { FileTreeResponse } from '../../src/shared/generated/FileTreeResponse'
import type { RunnerFileCommand } from '../../src/shared/generated/RunnerFileCommand'
import { RunnerFiles } from './runner'
import { FilesState } from './state'
import type { FilesStorage } from './storage'

/** The HTTP layer can use a Durable Object RPC adapter for this interface. */
export interface WorkspaceFilesPort {
  tree(): Promise<FileTreeResponse | null>
  changes(): Promise<ChangesResponse | null>
  read(
    path: string,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<FileResponse | null>
  diff(
    path: string,
    defaultBranch: string,
    signal?: AbortSignal,
  ): Promise<DiffResponse | null>
}

export class WorkspaceFiles implements WorkspaceFilesPort {
  readonly state: FilesState
  readonly runner: RunnerFiles

  constructor(storage: FilesStorage, requestId: () => string) {
    this.state = new FilesState(storage)
    this.runner = new RunnerFiles(requestId)
  }

  async connect(
    connectionId: string,
    send: (command: RunnerFileCommand) => void,
  ): Promise<void> {
    await this.state.beginConnection(connectionId)
    this.runner.attach(connectionId, send)
  }

  disconnect(connectionId: string): void {
    this.runner.detach(connectionId)
  }

  tree() {
    return this.state.tree()
  }
  changes() {
    return this.state.changes()
  }
  async read(path: string, maxBytes: number, signal?: AbortSignal) {
    return this.runner.read(path, maxBytes, signal)
  }
  async diff(path: string, defaultBranch: string, signal?: AbortSignal) {
    return this.runner.diff(path, defaultBranch, signal)
  }
}
