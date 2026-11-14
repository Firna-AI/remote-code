import type { AgentModel } from '../../shared/generated/AgentModel'
// @vitest-environment happy-dom

import { describe, expect, test, vi } from 'vitest'
import { productName } from '../../../docs/mockups/src/brand'
import { HeldRequests, requestLines } from '../../app/test-kit'
import {
  ACCOUNT_PATHS,
  agentLoginPath,
  refreshAgentLoginModelsPath,
  type AccountResponse,
  type AgentLoginStatus,
} from '../../shared/account'
import { MODELS_PATH } from '../../shared/agents'
import { ENDPOINT_ADDRESS_ERROR } from '../../shared/endpoint-address'
import { byRole } from '../../test-support/dom-queries'
import { FakeApiServer } from '../../test-support/fake-api'
import {
  coreFixtures,
  FAKE_TIME,
  fakeUser,
} from '../../test-support/fixtures/core'
import {
  holdAnimationFrames,
  MOUNTED_TEST_TIMEOUT,
} from '../../test-support/mount'
import { bodiesOf } from '../routines/routine-test-kit'
import { click, mountScreen, settle, typeText } from '../test-mount'
import { startedApp, textOf } from '../test-render'
import { fieldNamed } from '../workspace/kept-test-kit'
import { AccountScreen } from './AccountScreen'
import { listItems } from './test-markup'

vi.setConfig({ testTimeout: MOUNTED_TEST_TIMEOUT })

/** The models of the app, whose IDs differ from their labels, as on the Worker. */
const models: readonly AgentModel[] = [
  ['claude-opus-5-5', 'Opus 5.5'],
  ['claude-sonnet-5-5', 'Sonnet 5.5'],
  ['claude-fable-5-1', 'Fable 5.1'],
].map(([model, label]) => ({
  agent: 'claude',
  model,
  label,
  efforts: ['high'],
}))

const refreshPath = refreshAgentLoginModelsPath('claude')

/**
 * Claude on an own endpoint. With `missing`, its last model list, read a
 * minute before the clock of the test, did not name those model IDs.
 */
function endpointLogin(missing?: readonly string[]): AgentLoginStatus {
  return {
    agent: 'claude',
    connected: true,
    kind: 'endpoint',
    host: 'proxy.example.com',
    noReuse: false,
    updatedAt: FAKE_TIME,
    ...(missing
      ? { modelList: { missing, checkedAt: FAKE_TIME - 60_000 } }
      : {}),
  }
}

/** The account with this Claude login, and no Codex login. */
function accountWith(claude: AgentLoginStatus): AccountResponse {
  return {
    ...coreFixtures().account,
    agentLogins: [claude, { agent: 'codex', connected: false }],
  }
}

/** The General tab of the account, with the Connect form of `connect` open. */
async function mountGeneral(server: FakeApiServer, connect: 'claude' | null) {
  holdAnimationFrames()
  server.json('GET', MODELS_PATH, { models })
  const held = new HeldRequests(server)
  const app = await startedApp(server, { fetch: held.fetch })
  const view = mountScreen(
    app,
    <AccountScreen connect={connect} tab="agents" user={fakeUser} />,
  )
  await settle()
  return { view, held, claude: () => listItems(view.innerHTML, 'Agents')[0] }
}

/** The lines under a field, as a screen reader reads them: error, then hint. */
function linesOf(field: HTMLElement): string[] {
  return (field.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
}

/** Chooses the own endpoint kind in the open Connect form. */
function chooseEndpoint(view: HTMLElement): void {
  const kinds = byRole('radiogroup', 'Connect with', view)
  click(byRole('radio', 'Own endpoint', kinds))
}

describe('an own endpoint login on the account', () => {
  test.each([
    'http://localhost:8317',
    'https://8.8.8.8',
    'https://[2606:4700:4700::1111]',
  ])(
    'the form names the API and the models of the app, and refuses %s at its field with the rule of the save, before any request, and keeps the key',
    async (endpoint) => {
      const server = new FakeApiServer()
      server.json(
        'GET',
        ACCOUNT_PATHS.account,
        accountWith({ agent: 'claude', connected: false }),
      )
      const { view } = await mountGeneral(server, 'claude')
      chooseEndpoint(view)
      const text = Array.from(view.querySelectorAll('p'), (line) =>
        String(line.textContent),
      ).find((line) => line.startsWith('Use a gateway'))
      const empty = linesOf(fieldNamed(view, 'Endpoint'))
      typeText(fieldNamed(view, 'Endpoint'), endpoint)
      typeText(fieldNamed(view, 'API key'), 'key-of-the-proxy')
      const sent = server.requests.length
      click(byRole('button', 'Connect', view))
      await settle()
      expect(server.requests.length - sent).toBe(0)
      expect({
        text,
        empty,
        refused: linesOf(fieldNamed(view, 'Endpoint')),
        requests: server.requests.length - sent,
        key: fieldNamed(view, 'API key').value,
      }).toEqual({
        text: `Use a gateway or a proxy that serves the Anthropic Messages API, with the models that ${productName} offers: Opus 5.5, Sonnet 5.5, and Fable 5.1.`,
        empty: [
          `Requests go through ${productName} to https://gateway.example.com/v1/messages.`,
        ],
        refused: [
          'Use a public https:// address with a host name, without a user name or a password.',
        ],
        requests: 0,
        key: 'key-of-the-proxy',
      })
    },
  )

  test('a refusal of the address by the save shows at the address and not as a failed connect, and the next edit of the address clears it', async () => {
    const server = new FakeApiServer()
    server.json(
      'GET',
      ACCOUNT_PATHS.account,
      accountWith({ agent: 'claude', connected: false }),
    )
    const { view } = await mountGeneral(server, 'claude')
    chooseEndpoint(view)
    typeText(fieldNamed(view, 'Endpoint'), 'https://preview.example.com')
    typeText(fieldNamed(view, 'API key'), 'key-of-the-proxy')
    const error = ENDPOINT_ADDRESS_ERROR
    server.json('PUT', agentLoginPath('claude'), { error }, 400)
    click(byRole('button', 'Connect', view))
    await settle()
    const key = fieldNamed(view, 'API key')
    const refused = {
      address: linesOf(fieldNamed(view, 'Endpoint')),
      keyInvalid: key.getAttribute('aria-invalid') === 'true',
      key: key.value,
      notice: (view.textContent ?? '').includes("Claude wasn't connected"),
    }
    typeText(fieldNamed(view, 'Endpoint'), 'https://proxy.example.com')
    expect({ refused, edited: linesOf(fieldNamed(view, 'Endpoint')) }).toEqual({
      refused: {
        address: [
          'Use a public https:// address with a host name, without a user name or a password.',
        ],
        keyInvalid: false,
        key: 'key-of-the-proxy',
        notice: false,
      },
      edited: [
        `Requests go through ${productName} to https://proxy.example.com/v1/messages.`,
      ],
    })
  })

  test('a save sends the address as typed with the key, then the row shows the host, the model that the new list hides, and the share switch on', async () => {
    const server = new FakeApiServer()
    server.json(
      'GET',
      ACCOUNT_PATHS.account,
      accountWith({ agent: 'claude', connected: false }),
    )
    const { view, claude } = await mountGeneral(server, 'claude')
    chooseEndpoint(view)
    typeText(fieldNamed(view, 'Endpoint'), 'https://proxy.example.com/v1/')
    const typed = linesOf(fieldNamed(view, 'Endpoint'))
    typeText(fieldNamed(view, 'API key'), 'key-of-the-proxy')
    // The save answers without the list, which the account then holds.
    server.json('PUT', agentLoginPath('claude'), endpointLogin())
    server.json(
      'GET',
      ACCOUNT_PATHS.account,
      accountWith(endpointLogin(['claude-fable-5-1'])),
    )
    click(byRole('button', 'Connect', view))
    await settle()
    expect({
      typed,
      sent: await bodiesOf(server, 'PUT', agentLoginPath('claude')),
      row: textOf(claude()),
    }).toEqual({
      typed: [
        `Saves as https://proxy.example.com. Requests go through ${productName} to https://proxy.example.com/v1/messages.`,
      ],
      sent: [
        {
          agent: 'claude',
          kind: 'endpoint',
          endpoint: 'https://proxy.example.com/v1/',
          secret: 'key-of-the-proxy',
        },
      ],
      row: 'Claude Connected Remove Own endpoint at proxy.example.com Fable 5.1 is hidden from your model pickers, because this endpoint does not list it. Its model ID is claude-fable-5-1 . Checked 1 minute ago. Refresh Let other members use this login Their messages in your sessions use this login.',
    })
  })

  test('Refresh reads the list again, is busy until the account answers, and the line then follows the new list', async () => {
    const server = new FakeApiServer()
    server.json(
      'GET',
      ACCOUNT_PATHS.account,
      accountWith(endpointLogin(['claude-sonnet-5-5', 'claude-fable-5-1'])),
    )
    const { view, held, claude } = await mountGeneral(server, null)
    const before = textOf(claude())
    const refresh = () =>
      byRole('button', 'Refresh the model list of Claude', view)
    server.empty('POST', refreshPath)
    server.json('GET', ACCOUNT_PATHS.account, accountWith(endpointLogin([])))
    held.holdAnswer('GET', ACCOUNT_PATHS.account)
    click(refresh())
    await settle()
    const busy = refresh().getAttribute('aria-busy')
    held.release('GET', ACCOUNT_PATHS.account)
    await settle()
    expect({
      before,
      busy,
      refreshes: requestLines(server).filter(
        (line) => line === `POST ${refreshPath}`,
      ).length,
      after: textOf(claude()),
    }).toEqual({
      before:
        'Claude Connected Remove Own endpoint at proxy.example.com Sonnet 5.5 and Fable 5.1 are hidden from your model pickers, because this endpoint does not list them. Their model IDs are claude-sonnet-5-5 and claude-fable-5-1 . Checked 1 minute ago. Refresh Let other members use this login Their messages in your sessions use this login.',
      busy: 'true',
      refreshes: 1,
      after:
        'Claude Connected Remove Own endpoint at proxy.example.com Let other members use this login Their messages in your sessions use this login.',
    })
  })

  test('a list that names no Claude model of the app says that the pickers keep each one, with their IDs', async () => {
    const server = new FakeApiServer()
    server.json(
      'GET',
      ACCOUNT_PATHS.account,
      accountWith(endpointLogin(models.map((model) => model.model))),
    )
    const { claude } = await mountGeneral(server, null)
    expect(textOf(claude())).toBe(
      'Claude Connected Remove Own endpoint at proxy.example.com Your model pickers show Opus 5.5, Sonnet 5.5, and Fable 5.1, but this endpoint lists none of them. Their model IDs are claude-opus-5-5 , claude-sonnet-5-5 , and claude-fable-5-1 . Checked 1 minute ago. Refresh Let other members use this login Their messages in your sessions use this login.',
    )
  })
})
