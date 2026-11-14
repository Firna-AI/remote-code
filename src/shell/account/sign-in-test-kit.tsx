import { act } from 'react'
import type { Agent } from '../../shared/generated/Agent'
import { chatGptSignInCopy as copy } from '../../../docs/mockups/src/components/settings/chatGptSignInCopy'
import type { AppModel } from '../../app/app-model'
import type { ManualDelay } from '../../app/test-kit'
import {
  ACCOUNT_PATHS,
  codexDevicePath,
  type AgentLoginStatus,
  type PollCodexDeviceResponse,
  type StartCodexDeviceResponse,
} from '../../shared/account'
import {
  byRole,
  queryByRole,
  queryByText,
} from '../../test-support/dom-queries'
import type { FakeApiServer } from '../../test-support/fake-api'
import {
  coreFixtures,
  FAKE_TIME,
  fakeUser,
} from '../../test-support/fixtures/core'
import { holdAnimationFrames, press, waitFor } from '../../test-support/mount'
import { mountScreen } from '../test-mount'
import { startedApp, textOf } from '../test-render'
import { AccountScreen } from './AccountScreen'

/** The services of a test, such as a `ManualDelay` or a held fetch. */
type Overrides = Parameters<typeof startedApp>[1]

/** A sign-in that the Worker started, with a code that works 15 minutes. */
export function startedSignIn(
  handle: string,
  userCode: string,
): StartCodexDeviceResponse {
  return {
    handle,
    userCode,
    verificationUrl: 'https://auth.openai.com/codex/device',
    expiresAt: FAKE_TIME + 900_000,
    pollIntervalMs: 5_000,
  }
}

/** The Codex login that a ChatGPT sign-in connects, not shared. */
export const chatGptLogin = {
  agent: 'codex',
  connected: true,
  kind: 'token',
  noReuse: true,
  updatedAt: FAKE_TIME,
} as const satisfies AgentLoginStatus

/** The row of a Codex login on the ChatGPT plan that other members do not use. */
export const chatGptRow =
  'Codex Connected ChatGPT plan Remove Let other members use this login Their messages in your sessions start a new session on their own login.'

/**
 * Serves the account of the fixtures, a Claude token and a Codex API key,
 * with `logins` in place of the login of their agents. By default Codex
 * has no login.
 */
export function serveAccount(
  server: FakeApiServer,
  logins: readonly AgentLoginStatus[] = [{ agent: 'codex', connected: false }],
): void {
  const { account } = coreFixtures()
  server.json('GET', ACCOUNT_PATHS.account, {
    ...account,
    agentLogins: account.agentLogins.map(
      (login) => logins.find((item) => item.agent === login.agent) ?? login,
    ),
  })
}

/** An answer of the Worker that refuses a request, with its message. */
export function refusal(code: string, message: string) {
  return { error: { code, message } }
}

/** Answers Get a code with this sign-in. */
export function answerStart(
  server: FakeApiServer,
  started: StartCodexDeviceResponse,
): void {
  server.json('POST', ACCOUNT_PATHS.codexDevice, started)
}

/** Answers each later poll of the sign-in of `handle` with `answer`. */
export function answerPolls(
  server: FakeApiServer,
  handle: string,
  answer: PollCodexDeviceResponse,
): void {
  server.json('POST', codexDevicePath(handle), answer)
}

/** The number of requests that the server got with this method and path. */
export function requestsTo(
  server: FakeApiServer,
  method: string,
  path: string,
): number {
  return server.requests.filter(
    (request) =>
      request.method === method && new URL(request.url).pathname === path,
  ).length
}

/**
 * The account of the fake API on its General tab, with the services of
 * the test, such as a `ManualDelay`. `connect` opens the form of an agent.
 */
export async function openAccount(
  server: FakeApiServer,
  services: Overrides,
  connect: Agent | null,
): Promise<{ app: AppModel; view: HTMLElement }> {
  holdAnimationFrames()
  const app = await startedApp(server, services)
  const view = mountScreen(
    app,
    <AccountScreen connect={connect} tab="agents" user={fakeUser} />,
  )
  return { app, view }
}

/** The Codex form of the account, open on ChatGPT plan, with the delay. */
export async function openSignIn(
  server: FakeApiServer,
  delay: ManualDelay,
  services: Overrides = {},
): Promise<{ app: AppModel; view: HTMLElement }> {
  const opened = await openAccount(
    server,
    { ...services, delay: delay.delay },
    'codex',
  )
  await press(byRole('radio', 'ChatGPT plan', opened.view))
  return opened
}

/** Presses the button that asks for a code, and waits for the code. */
export async function getCode(
  view: HTMLElement,
  userCode: string,
  label: string = copy.getCode,
): Promise<void> {
  await press(byRole('button', label, view))
  await waitFor(() => queryByText(userCode, view), `the code ${userCode}`)
}

/**
 * Presses the button that asks for a code, and waits until the request
 * ends, whatever its answer: no button is busy any more.
 */
export async function askForCode(
  view: HTMLElement,
  label: string = copy.getCode,
): Promise<void> {
  await press(byRole('button', label, view))
  await waitFor(
    () => view.querySelector('[aria-busy="true"]') === null,
    'the end of the request for a code',
  )
}

/**
 * The address and the target of the link to the ChatGPT settings, or null
 * when the view has no such link.
 */
export function settingsLink(view: HTMLElement): (string | null)[] | null {
  const link = queryByRole('link', copy.settingsLink.label, view)
  return link && [link.getAttribute('href'), link.getAttribute('target')]
}

/** The text of the Codex form while it shows `userCode` and waits. */
export function codeShown(userCode: string): string {
  return `Codex API key ChatGPT plan Own endpoint ${copy.steps.before} auth.openai.com/codex/device ${copy.steps.after} ${userCode} ${copy.keep} ${copy.waiting} Cancel`
}

/** Runs the timer of the next poll, and lets its answer show. */
export async function runPoll(delay: ManualDelay): Promise<void> {
  await act(() => delay.runAll())
}

/**
 * The visible text of the list item of an agent, Claude first: its row,
 * its form, and its share setting.
 */
export function agentItem(view: HTMLElement, agent: Agent): string {
  const index = agent === 'claude' ? 0 : 1
  const item = byRole('list', 'Agents', view).children.item(index)
  return textOf(item?.outerHTML ?? '')
}

/** The visible text of the list item of Codex. */
export function codexItem(view: HTMLElement): string {
  return agentItem(view, 'codex')
}

/** The kinds of the switch of the open form, in their order. */
export function kindChoices(view: HTMLElement) {
  const group = byRole('radiogroup', 'Connect with', view)
  return Array.from(group.querySelectorAll('[role="radio"]'), (choice) => ({
    kind: choice.textContent,
    selected: choice.getAttribute('aria-checked') === 'true',
  }))
}
