import type { Agent } from '../shared/generated/Agent'
import { sessionAddressPath } from '../shared/session-link'
import { INVITE_CODE_ERROR_PARAMETER } from '../shared/waitlist'

export const SETTINGS_TABS = [
  'general',
  'repositories',
  'cloud-computer',
  'members',
] as const

export type SettingsTab = (typeof SETTINGS_TABS)[number]

/** The tabs of a saved routine on a phone: its form, and its runs. */
export type RoutineTab = 'routine' | 'runs'
/**
 * The tabs of the account. Only the Mac app shows This Mac, so a browser
 * shows General at its address.
 */
export const ACCOUNT_TABS = [
  'general',
  'agents',
  'preferences',
  'shortcuts',
  'this-mac',
] as const

export type AccountTab = (typeof ACCOUNT_TABS)[number]

/**
 * The tabs of the operator section that list and search: the orgs, the
 * users, the people who wait, and the codes.
 */
const OPERATOR_LISTS = ['orgs', 'users', 'waitlist', 'codes'] as const

type OperatorList = (typeof OPERATOR_LISTS)[number]

/**
 * A page of the operator section: a tab, or the page of one org or one
 * user. A tab of a list keeps its search, which is empty for the whole
 * list.
 */
export type OperatorView =
  | { page: 'overview' }
  | { page: OperatorList; search: string }
  | { page: 'org'; id: string }
  | { page: 'user'; githubId: number }

/** The screen that an address shows. */
export type Route =
  | { screen: 'home' }
  | { screen: 'get-started' }
  /** `connect` opens the Connect form of that agent on the Agents tab. */
  | { screen: 'account'; tab: AccountTab; connect: Agent | null }
  | { screen: 'create-org'; first: boolean }
  | { screen: 'org'; orgId: string }
  | { screen: 'new-workspace'; orgId: string; sectionId: string | null }
  /**
   * `view` holds the path after the workspace, such as `files`, for its
   * tabs. A session address names its session in `session`, with no view.
   */
  | {
      screen: 'workspace'
      orgId: string
      workspaceId: string
      view: readonly string[]
      session?: string
    }
  | { screen: 'settings'; orgId: string; tab: SettingsTab }
  | { screen: 'routines'; orgId: string }
  | { screen: 'new-routine'; orgId: string }
  /** A phone shows the form of a saved routine and its runs in two tabs. */
  | {
      screen: 'routine'
      orgId: string
      routineId: string
      tab: RoutineTab
    }
  /** The operator section. The shell shows it only to an operator. */
  | { screen: 'operator'; view: OperatorView }
  /**
   * The join link of an invite code. `error` is the error code of the API
   * when the code of the link did not work at the sign-in.
   */
  | { screen: 'join'; code: string; error: string | null }
  | { screen: 'not-found' }

const encode = encodeURIComponent

/** The address of a list of the operator, with its search in `q`. */
function operatorList(list: OperatorList, search: string): string {
  const query = new URLSearchParams()
  if (search !== '') query.set('q', search)
  return query.size ? `/operator/${list}?${query}` : `/operator/${list}`
}

/** The address of each screen. Tabs are links, so each tab has its own. */
export const routes = {
  home: () => '/',
  getStarted: () => '/get-started',
  /** General, or the Agents tab with the Connect form of `connect` open. */
  account: (connect?: Agent) =>
    connect ? `/account/agents?connect=${connect}` : '/account',
  accountTab: (tab: AccountTab) =>
    tab === 'general' ? '/account' : `/account/${tab}`,
  createOrg: (first = false) => (first ? '/orgs/new?first=1' : '/orgs/new'),
  org: (orgId: string) => `/orgs/${encode(orgId)}`,
  newWorkspace: (orgId: string, sectionId?: string) =>
    sectionId
      ? `/orgs/${encode(orgId)}/new?section=${encode(sectionId)}`
      : `/orgs/${encode(orgId)}/new`,
  workspace: (orgId: string, workspaceId: string, ...view: string[]) =>
    [`/orgs/${encode(orgId)}/workspaces/${encode(workspaceId)}`]
      .concat(view.map(encode))
      .join('/'),
  /** The address of a session, which the Worker builds the same way. */
  session: sessionAddressPath,
  settings: (orgId: string, tab: SettingsTab = 'general') =>
    tab === 'general'
      ? `/orgs/${encode(orgId)}/settings`
      : `/orgs/${encode(orgId)}/settings/${tab}`,
  routines: (orgId: string) => `/orgs/${encode(orgId)}/routines`,
  newRoutine: (orgId: string) => `/orgs/${encode(orgId)}/routines/new`,
  routine: (orgId: string, routineId: string, tab: RoutineTab = 'routine') =>
    tab === 'routine'
      ? `/orgs/${encode(orgId)}/routines/${encode(routineId)}`
      : `/orgs/${encode(orgId)}/routines/${encode(routineId)}/runs`,
  operator: () => '/operator',
  operatorOrgs: (search = '') => operatorList('orgs', search),
  operatorUsers: (search = '') => operatorList('users', search),
  operatorWaitlist: (search = '') => operatorList('waitlist', search),
  operatorCodes: (search = '') => operatorList('codes', search),
  operatorOrg: (orgId: string) => `/operator/orgs/${encode(orgId)}`,
  operatorUser: (githubId: number) => `/operator/users/${githubId}`,
} as const

/** The tab of a path segment. No segment is the first tab. */
function tabOf<Tab extends string>(
  tabs: readonly [Tab, ...Tab[]],
  value: string | undefined,
): Tab | null {
  if (value === undefined) return tabs[0]
  return tabs.find((tab) => tab === value) ?? null
}

function agentParam(value: string | null): Agent | null {
  return value === 'claude' || value === 'codex' ? value : null
}

/** A numeric GitHub user ID, as the address of a user writes it. */
function githubIdOf(segment: string): number | null {
  if (!/^[1-9]\d*$/.test(segment)) return null
  const id = Number(segment)
  return Number.isSafeInteger(id) ? id : null
}

/**
 * The page of an address under `/operator`, from the parts after it. A
 * search of only spaces is no search.
 */
function operatorView(
  parts: readonly string[],
  query: URLSearchParams,
): OperatorView | null {
  const [first, id, ...rest] = parts
  const search = query.get('q')?.trim() ?? ''
  if (first === undefined) return { page: 'overview' }
  const list = OPERATOR_LISTS.find((item) => item === first)
  if (list === undefined || rest.length > 0) return null
  if (id === undefined) return { page: list, search }
  if (list === 'orgs') return { page: 'org', id }
  if (list !== 'users') return null
  const githubId = githubIdOf(id)
  return githubId === null ? null : { page: 'user', githubId }
}

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

function isText(segment: string | null): segment is string {
  return segment !== null
}

/** Reads the screen of an address. An unknown address is `not-found`. */
export function parseRoute(pathname: string, search: string): Route {
  const query = new URLSearchParams(search)
  const parts = pathname.split('/').filter((part) => part !== '')
  const segments = parts.map(decode)
  if (segments.some((segment) => segment === null)) {
    return { screen: 'not-found' }
  }
  const decoded = segments.filter(isText)
  const [first, orgId, area, id, ...rest] = decoded
  if (first === undefined) return { screen: 'home' }
  if (first === 'operator') {
    const view = operatorView(decoded.slice(1), query)
    return view ? { screen: 'operator', view } : { screen: 'not-found' }
  }
  if (first === 'join') {
    return orgId === undefined || area !== undefined
      ? { screen: 'not-found' }
      : {
          screen: 'join',
          code: orgId,
          error: query.get(INVITE_CODE_ERROR_PARAMETER),
        }
  }
  if (first === 'get-started' && orgId === undefined) {
    return { screen: 'get-started' }
  }
  if (first === 'account' && area === undefined) {
    // The segment after `account` names the tab.
    const tab = tabOf(ACCOUNT_TABS, orgId)
    const connect = agentParam(query.get('connect'))
    if (tab) {
      // An older link put `?connect=` on General, which no longer holds the
      // agents, so it opens the Agents tab.
      const shown = tab === 'general' && connect ? 'agents' : tab
      return { screen: 'account', tab: shown, connect }
    }
  }
  if (first !== 'orgs' || orgId === undefined) return { screen: 'not-found' }
  if (orgId === 'new' && area === undefined) {
    return { screen: 'create-org', first: query.get('first') === '1' }
  }
  if (area === undefined) return { screen: 'org', orgId }
  if (area === 'new' && id === undefined) {
    return { screen: 'new-workspace', orgId, sectionId: query.get('section') }
  }
  if (area === 'workspaces' && id !== undefined) {
    // Only `sessions` and an ID, with nothing after them, name a session.
    const [sessions, session, ...more] = rest
    if (sessions === 'sessions' && session !== undefined && more.length === 0) {
      return { screen: 'workspace', orgId, workspaceId: id, view: [], session }
    }
    return { screen: 'workspace', orgId, workspaceId: id, view: rest }
  }
  if (area === 'settings' && rest.length === 0) {
    const tab = tabOf(SETTINGS_TABS, id)
    if (tab) return { screen: 'settings', orgId, tab }
  }
  if (area === 'routines') {
    if (id === undefined) return { screen: 'routines', orgId }
    if (id === 'new' && rest.length === 0) {
      return { screen: 'new-routine', orgId }
    }
    if (id !== 'new' && rest.length === 0) {
      return { screen: 'routine', orgId, routineId: id, tab: 'routine' }
    }
    if (id !== 'new' && rest.length === 1 && rest[0] === 'runs') {
      return { screen: 'routine', orgId, routineId: id, tab: 'runs' }
    }
  }
  return { screen: 'not-found' }
}

/** The org that a screen belongs to, such as the org of the command palette. */
export function routeOrgId(route: Route): string | null {
  return 'orgId' in route ? route.orgId : null
}
