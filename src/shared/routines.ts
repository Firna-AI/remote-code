import type { WorkspaceState } from './generated/WorkspaceState'
import type { Agent } from './generated/Agent'
import type { AgentChoice } from './generated/AgentChoice'
import type { Timestamp } from './generated/Timestamp'
import type { MessageSender } from './generated/MessageSender'
import { orgPath } from './api'

export function routinesPath(orgId: string): string {
  return `${orgPath(orgId)}/routines`
}

export function routinePath(orgId: string, routineId: string): string {
  return `${routinesPath(orgId)}/${encodeURIComponent(routineId)}`
}

export const routinePaths = {
  runs: (orgId: string, id: string, before?: string) =>
    `${routinePath(orgId, id)}/runs${before === undefined ? '' : `?before=${encodeURIComponent(before)}`}`,
  runNow: (orgId: string, id: string) => `${routinePath(orgId, id)}/run-now`,
} as const

export type RoutineWeekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'

type ClockTime = { hour: number; minute: number }

export type RoutineSchedule =
  | { kind: 'hourly'; minute: number }
  | { kind: 'daily'; time: ClockTime }
  | { kind: 'weekdays'; time: ClockTime }
  | { kind: 'weekly'; day: RoutineWeekday; time: ClockTime }
  | { kind: 'custom'; cron: string }

export type RoutinePullRequestEvent = 'opened' | 'pushed' | 'merged'

export interface RoutineAuthorFilterInput {
  members: boolean
  is: readonly string[]
  isNot: readonly string[]
}

export interface RoutineAuthorAccount {
  githubId: number
  login: string
}

export interface RoutineAuthorFilter {
  members: boolean
  is: readonly RoutineAuthorAccount[]
  isNot: readonly RoutineAuthorAccount[]
}

export type RoutineTriggerInput =
  | RoutineSchedule
  | {
      kind: 'pull-request'
      event: RoutinePullRequestEvent
      authors?: RoutineAuthorFilterInput
    }

export type RoutineTrigger =
  | (RoutineSchedule & { cron: string })
  | {
      kind: 'pull-request'
      event: RoutinePullRequestEvent
      authors?: RoutineAuthorFilter
    }

export type RoutineInactiveReason =
  'owner_left' | 'repository_removed' | 'failed_runs'

export interface Routine {
  id: string
  orgId: string
  owner: MessageSender
  movedFrom: string | null
  name: string
  repositoryId: string
  sectionId: string
  prompt: string
  choice: AgentChoice
  active: boolean
  inactiveReason: RoutineInactiveReason | null
  failedRunsInARow: number
  timeZone: string
  triggers: readonly RoutineTrigger[]
  nextRunAt: Timestamp | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type RoutineRunTrigger =
  | {
      kind: 'schedule'
      schedule: RoutineSchedule['kind']
      scheduledAt: Timestamp
    }
  | { kind: 'run-now' }
  | {
      kind: 'pull-request'
      event: RoutinePullRequestEvent
      number: number
      url: string
      headBranch: string
      headSha: string
      baseBranch: string
      skipLogin?: string
    }

export interface RoutineRun {
  id: string
  routineId: string
  orgId: string
  agent: Agent | null
  owner: MessageSender | null
  trigger: RoutineRunTrigger
  state: WorkspaceState | 'queued' | 'failed' | 'skipped'
  workspaceId: string | null
  error: { code: string; message: string } | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface CreateRoutineRequest {
  name?: string
  repositoryId: string
  sectionId?: string
  prompt: string
  choice: AgentChoice
  active?: boolean
  timeZone: string
  triggers: readonly RoutineTriggerInput[]
}

export type UpdateRoutineRequest = Partial<CreateRoutineRequest>

export interface RoutineResponse {
  routine: Routine
}

export interface RoutinesResponse {
  routines: readonly (Routine & { lastRun: RoutineRun | null })[]
}

export interface RunRoutineRequest {
  requestId: string
}

export interface RoutineRunResponse {
  run: RoutineRun
}

export interface RoutineRunsResponse {
  runs: readonly RoutineRun[]
  nextCursor: string | null
}
