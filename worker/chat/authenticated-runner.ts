import type { WorkspaceToRunner } from '../../src/shared/generated/WorkspaceToRunner'
import { CONNECTION_CHECK_MS } from '../security/connection-access'
import { RunnerAccessDenied } from './login-access'
import type {
  ChatDependencies,
  RunnerPeer,
  RunnerWorkspaceRecord,
} from './types'

export class AuthenticatedRunner {
  private closed = false
  private cancelCheck: (() => void) | null = null
  private readonly source: RunnerPeer
  private readonly workspace: RunnerWorkspaceRecord
  private readonly dependencies: ChatDependencies
  private readonly detached: () => void

  constructor(
    source: RunnerPeer,
    workspace: RunnerWorkspaceRecord,
    dependencies: ChatDependencies,
    detached: () => void,
  ) {
    this.source = source
    this.workspace = workspace
    this.dependencies = dependencies
    this.detached = detached
    this.schedule()
  }

  matches(peer: RunnerPeer): boolean {
    return this.source === peer
  }

  async authorize(): Promise<boolean> {
    if (this.closed) return false
    try {
      const allowed = await this.dependencies.readRunnerAccess(
        this.workspace.id,
        this.workspace.tokenHash,
      )
      if (allowed && !this.closed) return true
    } catch {
      // A failed access read cannot keep this transport open.
    }
    this.close()
    return false
  }

  async send(message: WorkspaceToRunner): Promise<void> {
    if (!(await this.authorize())) throw new RunnerAccessDenied()
    this.source.send(message)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.cancelCheck?.()
    this.cancelCheck = null
    this.detached()
    try {
      this.source.close()
    } catch {
      /* The source is already closed. */
    }
  }

  private schedule(): void {
    if (this.closed) return
    this.cancelCheck =
      this.dependencies.scheduleRunnerCheck?.(async () => {
        this.cancelCheck = null
        if (await this.authorize()) this.schedule()
      }, CONNECTION_CHECK_MS) ?? null
  }
}
