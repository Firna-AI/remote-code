import type { AppDependencies, AppEnv } from '../env'

type SoftwareImageState = 'building' | 'ready' | 'failed' | 'deleting'
type SoftwareImagePhase =
  | 'create'
  | 'allocating'
  | 'software'
  | 'journal'
  | 'snapshot'
  | 'publish'
  | 'cleanup'
  | 'done'

export interface SoftwareImage {
  id: string
  providerAccount: string
  version: string
  softwareJson: string
  snapshotName: string
  snapshotRecorded: number
  state: SoftwareImageState
  phase: SoftwareImagePhase
  revision: number
  sandboxId: string | null
  processId: number | null
  stdoutOffset: number
  stderrOffset: number
  output: string
  error: string | null
  tokenDigest: string
  startedAt: number
  completedAt: number | null
}

export interface SoftwareImageRuntime {
  env: AppEnv
  dependencies: AppDependencies
}

export interface SoftwareImageResult {
  state: 'building' | 'ready' | 'failed'
  phase: SoftwareImagePhase
  version: string
  output: string
  error?: string
  keptOutput?: string
}
