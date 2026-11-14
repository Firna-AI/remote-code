import type { MessageSender } from '../../shared/generated/MessageSender'
import {
  routinePath,
  routinesPath,
  type Routine,
  type RoutineResponse,
  type RoutinesResponse,
} from '../../shared/routines'
import { flag, record, text, type JsonObject } from '../api/parse'
import { requireOrg, type DevBackend } from './backend'
import { ID, json, noContent, optional, type Route } from './router'
import {
  choiceOf,
  nextRunOf,
  promptOf,
  repositoryOf,
  sectionOf,
  storedTriggers,
  timeZoneOf,
} from './routine-input'
import { ownerRequired, requireRoutine, routineRuns } from './routine-records'
import { slugify, uniqueId, type OrgState } from './state'

function reply(routine: Routine, status = 200): Response {
  return json({ routine } satisfies RoutineResponse, status)
}

/** The signed-in person, as the owner of a routine. */
function senderOf(backend: DevBackend): MessageSender {
  const { user } = backend.state.account
  return {
    id: user.id,
    githubLogin: user.githubLogin,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  }
}

/** A new routine of the signed-in person, as the Worker checks and stores it. */
function createRoutine(backend: DevBackend, org: OrgState, body: unknown) {
  const fields = record(body)
  const now = backend.now()
  const name = optional(fields, 'name', text)?.trim() || 'Untitled routine'
  const routine: Routine = {
    id: uniqueId(
      slugify(name, 'routine'),
      org.routines.map((item) => item.id),
    ),
    orgId: org.org.id,
    owner: senderOf(backend),
    movedFrom: null,
    name,
    repositoryId: repositoryOf(org, fields),
    sectionId: sectionOf(org, optional(fields, 'sectionId', text)),
    prompt: promptOf(fields),
    choice: choiceOf(fields),
    active: optional(fields, 'active', flag) ?? true,
    inactiveReason: null,
    failedRunsInARow: 0,
    timeZone: timeZoneOf(fields),
    triggers: storedTriggers(org, fields.triggers),
    nextRunAt: null,
    createdAt: now,
    updatedAt: now,
  }
  const saved = { ...routine, nextRunAt: nextRunOf(routine, now) }
  org.routines = [saved, ...org.routines]
  return reply(saved, 201)
}

/** The fields of an update that the owner sent, each checked as on create. */
function updated(org: OrgState, routine: Routine, fields: JsonObject): Routine {
  const has = (key: string) => fields[key] !== undefined
  const active = optional(fields, 'active', flag) ?? routine.active
  const turnedOn = active && !routine.active
  return {
    ...routine,
    name: has('name')
      ? text(fields, 'name').trim() || 'Untitled routine'
      : routine.name,
    repositoryId: has('repositoryId')
      ? repositoryOf(org, fields)
      : routine.repositoryId,
    sectionId: has('sectionId')
      ? sectionOf(org, text(fields, 'sectionId'))
      : routine.sectionId,
    prompt: has('prompt') ? promptOf(fields) : routine.prompt,
    choice: has('choice') ? choiceOf(fields) : routine.choice,
    active,
    inactiveReason: active || routine.active ? null : routine.inactiveReason,
    failedRunsInARow: turnedOn ? 0 : routine.failedRunsInARow,
    timeZone: has('timeZone') ? timeZoneOf(fields) : routine.timeZone,
    triggers: has('triggers')
      ? storedTriggers(org, fields.triggers)
      : routine.triggers,
  }
}

/**
 * An update of a routine. Its owner changes each field. An admin, or the
 * owner, can also turn it off alone, with `{ "active": false }`.
 */
function updateRoutine(
  backend: DevBackend,
  org: OrgState,
  routineId: string,
  body: unknown,
) {
  const fields = record(body)
  const routine = requireRoutine(org, routineId)
  const owner = routine.owner.id === backend.state.account.user.id
  const turnOff =
    fields.active === false &&
    Object.keys(fields).every((key) => key === 'active')
  if (!owner && !(turnOff && org.org.role === 'admin')) throw ownerRequired()
  const now = backend.now()
  const next = updated(org, routine, fields)
  const saved = { ...next, nextRunAt: nextRunOf(next, now), updatedAt: now }
  org.routines = org.routines.map((item) =>
    item.id === routineId ? saved : item,
  )
  return reply(saved)
}

/** Deletes a routine of its owner, or of an admin. Its runs go with it. */
function deleteRoutine(backend: DevBackend, org: OrgState, routineId: string) {
  const routine = requireRoutine(org, routineId)
  const owner = routine.owner.id === backend.state.account.user.id
  if (!owner && org.org.role !== 'admin') throw ownerRequired()
  org.routines = org.routines.filter((item) => item.id !== routineId)
  org.runs = org.runs.filter((run) => run.routineId !== routineId)
  return noContent()
}

/** The routines of an org: the list with the newest run of each, and one routine. */
export function routineRoutes(backend: DevBackend): Route[] {
  const orgOf = (org: string) => requireOrg(backend.state, org)
  return [
    {
      method: 'GET',
      path: routinesPath(ID.org),
      answer: ({ params }) => {
        const org = orgOf(params.org)
        return json({
          routines: org.routines.map((routine) => ({
            ...routine,
            lastRun: routineRuns(org, routine.id)[0] ?? null,
          })),
        } satisfies RoutinesResponse)
      },
    },
    {
      method: 'POST',
      path: routinesPath(ID.org),
      answer: ({ params, body }) =>
        createRoutine(backend, orgOf(params.org), body),
    },
    {
      method: 'GET',
      path: routinePath(ID.org, ID.routine),
      answer: ({ params }) =>
        reply(requireRoutine(orgOf(params.org), params.routine)),
    },
    {
      method: 'PATCH',
      path: routinePath(ID.org, ID.routine),
      answer: ({ params, body }) =>
        updateRoutine(backend, orgOf(params.org), params.routine, body),
    },
    {
      method: 'DELETE',
      path: routinePath(ID.org, ID.routine),
      answer: ({ params }) =>
        deleteRoutine(backend, orgOf(params.org), params.routine),
    },
  ]
}
