import type { AgentChoice } from '../../shared/generated/AgentChoice'
import type {
  Routine,
  RoutineAuthorFilterInput,
  RoutineTrigger,
  RoutineTriggerInput,
  RoutineWeekday,
} from '../../shared/routines'
import {
  fakeAccount,
  storedTrigger,
} from '../../test-support/fixtures/routine-triggers'
import {
  choice,
  count,
  flag,
  items,
  maybeNested,
  nested,
  record,
  text,
  texts,
  type JsonObject,
} from '../api/parse'
import { readChoice } from '../api/read-core'
import { cronProblem } from '../routine-cron'
import { RouteError } from './router'
import type { OrgState } from './state'

/** The accounts outside the org that the fake GitHub knows, such as bots. */
const knownAccounts = [
  'dependabot[bot]',
  'renovate[bot]',
  'github-actions[bot]',
]

const weekdays = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const satisfies readonly RoutineWeekday[]

function readTime(value: unknown) {
  const time = record(value, 'time')
  return { hour: count(time, 'hour'), minute: count(time, 'minute') }
}

function readAuthors(value: unknown): RoutineAuthorFilterInput {
  const filter = record(value, 'authors')
  return {
    members: flag(filter, 'members'),
    is: texts(filter, 'is'),
    isNot: texts(filter, 'isNot'),
  }
}

/** A trigger of a save, with logins and without the cron of a preset. */
function readTriggerInput(value: unknown): RoutineTriggerInput {
  const trigger = record(value, 'trigger')
  const kind = choice(trigger, 'kind', [
    'hourly',
    'daily',
    'weekdays',
    'weekly',
    'custom',
    'pull-request',
  ])
  switch (kind) {
    case 'hourly':
      return { kind, minute: count(trigger, 'minute') }
    case 'daily':
    case 'weekdays':
      return { kind, time: nested(trigger, 'time', readTime) }
    case 'weekly':
      return {
        kind,
        day: choice(trigger, 'day', weekdays),
        time: nested(trigger, 'time', readTime),
      }
    case 'custom':
      return { kind, cron: text(trigger, 'cron').trim().replace(/\s+/g, ' ') }
    case 'pull-request': {
      const authors = maybeNested(trigger, 'authors', readAuthors)
      return {
        kind,
        event: choice(trigger, 'event', ['opened', 'pushed', 'merged']),
        ...(authors === null ? {} : { authors }),
      }
    }
  }
}

/**
 * Refuses the first login of the author filters that the fake GitHub does
 * not know, with its trigger and its list, as the Worker does.
 */
function checkLogins(
  inputs: readonly RoutineTriggerInput[],
  known: (login: string) => string | undefined,
): void {
  for (const [triggerIndex, input] of inputs.entries()) {
    if (input.kind !== 'pull-request' || !input.authors) continue
    for (const list of ['is', 'isNot'] as const) {
      const login = input.authors[list].find((item) => !known(item))
      if (login === undefined) continue
      throw new RouteError(
        400,
        'unknown_github_login',
        `GitHub account ${login} was not found. Check the login.`,
        { login, triggerIndex, list },
      )
    }
  }
}

/**
 * The triggers of a save, as the Worker stores them. A custom cron must run
 * at most once an hour, and each login must name an account that the fake
 * GitHub knows: a member of the org, or a known bot.
 */
export function storedTriggers(
  org: OrgState,
  value: unknown,
): RoutineTrigger[] {
  const members = org.members.members.map((member) => member.user.githubLogin)
  const known = (login: string) =>
    [...members, ...knownAccounts].find(
      (item) => item.toLowerCase() === login.toLowerCase(),
    )
  const inputs = items(record({ value }), 'value', readTriggerInput)
  for (const input of inputs) {
    if (input.kind === 'custom' && cronProblem(input.cron) !== null) {
      throw new RouteError(
        400,
        'invalid_schedule',
        'Use five cron fields with one minute, for a schedule that runs at most once an hour.',
      )
    }
  }
  checkLogins(inputs, known)
  return inputs.map((input) =>
    storedTrigger(input, (login) => fakeAccount(known(login) ?? login)),
  )
}

/** A prompt with text, as the Worker requires. */
export function promptOf(fields: JsonObject): string {
  const prompt = text(fields, 'prompt')
  if (prompt.trim() === '') {
    throw new RouteError(400, 'invalid_input', 'Complete the required fields.')
  }
  return prompt
}

export function repositoryOf(org: OrgState, fields: JsonObject): string {
  const id = text(fields, 'repositoryId')
  if (!org.repositories.some((item) => item.id === id && item.selected)) {
    throw new RouteError(
      404,
      'repository_not_found',
      'The repository is not available.',
    )
  }
  return id
}

export function sectionOf(org: OrgState, id: string | undefined): string {
  const section = org.sections.find((item) =>
    id === undefined ? item.isDefault : item.id === id,
  )
  if (!section) {
    throw new RouteError(
      404,
      'section_not_found',
      'The section is not available.',
    )
  }
  return section.id
}

export function timeZoneOf(fields: JsonObject): string {
  const timeZone = text(fields, 'timeZone')
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(0)
  } catch {
    throw new RouteError(400, 'invalid_time_zone', 'Choose a valid time zone.')
  }
  return timeZone
}

export function choiceOf(fields: JsonObject): AgentChoice {
  return nested(fields, 'choice', readChoice)
}

/** The next time of a routine that is on and has a schedule, in this fake. */
export function nextRunOf(
  routine: Pick<Routine, 'active' | 'triggers'>,
  now: number,
): number | null {
  const scheduled = routine.triggers.some(
    (item) => item.kind !== 'pull-request',
  )
  return routine.active && scheduled ? now + 3_600_000 : null
}
