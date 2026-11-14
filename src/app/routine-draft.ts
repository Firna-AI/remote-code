import type { AgentChoice } from '../shared/generated/AgentChoice'
import type { Repository } from '../shared/org-settings'
import type {
  CreateRoutineRequest,
  Routine,
  RoutineAuthorFilterInput,
  RoutineTrigger,
  RoutineTriggerInput,
  UpdateRoutineRequest,
} from '../shared/routines'
import type { Section } from '../shared/sections'
import { cronProblem } from './routine-cron'

/**
 * A routine as its owner edits it. The triggers hold logins, as a save
 * sends them, and no cron for a preset, which the Worker computes.
 */
export interface RoutineDraft {
  name: string
  active: boolean
  repositoryId: string
  sectionId: string
  prompt: string
  choice: AgentChoice
  timeZone: string
  triggers: readonly RoutineTriggerInput[]
}

/** A saved trigger as the form edits it: logins, and no cron of a preset. */
function triggerInputOf(trigger: RoutineTrigger): RoutineTriggerInput {
  switch (trigger.kind) {
    case 'hourly':
      return { kind: trigger.kind, minute: trigger.minute }
    case 'daily':
    case 'weekdays':
      return { kind: trigger.kind, time: trigger.time }
    case 'weekly':
      return { kind: trigger.kind, day: trigger.day, time: trigger.time }
    case 'custom':
      return { kind: trigger.kind, cron: trigger.cron }
    case 'pull-request': {
      const { authors } = trigger
      if (!authors) return { kind: trigger.kind, event: trigger.event }
      return {
        kind: trigger.kind,
        event: trigger.event,
        authors: {
          members: authors.members,
          is: authors.is.map((account) => account.login),
          isNot: authors.isNot.map((account) => account.login),
        },
      }
    }
  }
}

export function draftOf(routine: Routine): RoutineDraft {
  return {
    name: routine.name,
    active: routine.active,
    repositoryId: routine.repositoryId,
    sectionId: routine.sectionId,
    prompt: routine.prompt,
    choice: routine.choice,
    timeZone: routine.timeZone,
    triggers: routine.triggers.map(triggerInputOf),
  }
}

/**
 * The draft of a new routine: active, without a name, a prompt, or a
 * trigger, in the first chosen repository of the org and its General
 * section, with the owner's default model and the time zone of the browser.
 */
export function newRoutineDraft(defaults: {
  repositories: readonly Repository[]
  sections: readonly Section[]
  choice: AgentChoice
  timeZone: string
}): RoutineDraft {
  const repository = defaults.repositories.find((item) => item.selected)
  const general =
    defaults.sections.find((section) => section.isDefault) ??
    defaults.sections[0]
  return {
    name: '',
    active: true,
    repositoryId: repository?.id ?? '',
    sectionId: general?.id ?? '',
    prompt: '',
    choice: defaults.choice,
    timeZone: defaults.timeZone,
    triggers: [],
  }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

function sameAuthors(
  a: RoutineAuthorFilterInput | undefined,
  b: RoutineAuthorFilterInput | undefined,
): boolean {
  if (!a || !b) return a === b
  return (
    a.members === b.members &&
    sameList(a.is, b.is) &&
    sameList(a.isNot, b.isNot)
  )
}

function sameTrigger(a: RoutineTriggerInput, b: RoutineTriggerInput): boolean {
  switch (a.kind) {
    case 'hourly':
      return b.kind === a.kind && b.minute === a.minute
    case 'daily':
    case 'weekdays':
      return (
        b.kind === a.kind &&
        b.time.hour === a.time.hour &&
        b.time.minute === a.time.minute
      )
    case 'weekly':
      return (
        b.kind === a.kind &&
        b.day === a.day &&
        b.time.hour === a.time.hour &&
        b.time.minute === a.time.minute
      )
    case 'custom':
      return b.kind === a.kind && b.cron === a.cron
    case 'pull-request':
      return (
        b.kind === a.kind &&
        b.event === a.event &&
        sameAuthors(a.authors, b.authors)
      )
  }
}

function sameTriggers(
  a: readonly RoutineTriggerInput[],
  b: readonly RoutineTriggerInput[],
): boolean {
  return (
    a.length === b.length &&
    a.every((item, index) => sameTrigger(item, b[index]))
  )
}

function sameChoice(a: AgentChoice, b: AgentChoice): boolean {
  return (
    a.agent === b.agent &&
    a.model === b.model &&
    a.effort === b.effort &&
    a.fast === b.fast
  )
}

/** The equality of each field of a record. */
type FieldEqualities<T> = {
  readonly [K in keyof T]-?: (a: T[K], b: T[K]) => boolean
}

/** Whether the field `key` of two records differs. */
function differs<T, K extends keyof T>(
  fields: FieldEqualities<T>,
  key: K,
  a: T,
  b: T,
): boolean {
  return !fields[key](a[key], b[key])
}

/**
 * The equality of each field of a draft. A save sends the fields that
 * differ from the saved routine, and the form follows a newer routine field
 * by field with the same equality.
 */
export const draftFields: FieldEqualities<RoutineDraft> = {
  name: Object.is,
  active: Object.is,
  repositoryId: Object.is,
  sectionId: Object.is,
  prompt: Object.is,
  choice: sameChoice,
  timeZone: Object.is,
  triggers: sameTriggers,
}

export function sameDraft(a: RoutineDraft, b: RoutineDraft): boolean {
  return Object.keys(updateRequest(a, b)).length === 0
}

/** The request that creates a routine from its draft. */
export function createRequest(draft: RoutineDraft): CreateRoutineRequest {
  return { ...draft, triggers: [...draft.triggers] }
}

/**
 * The fields of the draft that differ from the saved routine. The Worker
 * keeps each field that an update leaves out. So an edit sends Active only
 * when the owner changed it, and keeps a turn-off of the app since the read.
 */
export function updateRequest(
  saved: RoutineDraft,
  draft: RoutineDraft,
): UpdateRoutineRequest {
  const changed = (key: keyof RoutineDraft) =>
    differs(draftFields, key, draft, saved)
  const request: UpdateRoutineRequest = {}
  if (changed('name')) request.name = draft.name
  if (changed('active')) request.active = draft.active
  if (changed('repositoryId')) request.repositoryId = draft.repositoryId
  if (changed('sectionId')) request.sectionId = draft.sectionId
  if (changed('prompt')) request.prompt = draft.prompt
  if (changed('choice')) request.choice = draft.choice
  if (changed('timeZone')) request.timeZone = draft.timeZone
  if (changed('triggers')) request.triggers = [...draft.triggers]
  return request
}

/**
 * Whether a save can send the draft: the prompt has text, the routine has
 * a repository, and each custom cron passes.
 */
export function draftReady(draft: RoutineDraft): boolean {
  return (
    draft.prompt.trim() !== '' &&
    draft.repositoryId !== '' &&
    draft.triggers.every(
      (trigger) =>
        trigger.kind !== 'custom' || cronProblem(trigger.cron) === null,
    )
  )
}
