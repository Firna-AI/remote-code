import { describe, expect, it } from 'vitest'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import composerStyles from '../../../docs/mockups/src/components/chat/Composer.module.css'
import { ACCOUNT_PATHS } from '../../shared/account'
import type { OrgRole } from '../../shared/api'
import { membersPath } from '../../shared/members'
import {
  coreFixtures,
  FAKE_IDS,
  FAKE_TIME,
} from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { loginGone, loginPrivate, withSessions } from '../state/linked-kit'
import { renderChat, textOf } from './render-kit'

const id = FAKE_IDS.session
const sendOff = /aria-label="Send" aria-disabled="true"/
/** The end of every login label, such as "Cal's login". */
const loginLabel = "'s login"

/** The words of the composer up to Send, so of the box and its bar. */
function beforeSend(markup: string): string {
  return textOf(markup.slice(0, markup.indexOf('aria-label="Send"')))
}

/**
 * The words of the whole composer: the box and its bar.
 * It fails when the chat shows no composer, so no check of it can pass on a
 * chat without one.
 */
function composerText(markup: string): string {
  const start = markup.indexOf(`class="${composerStyles.wrap}"`)
  expect(start).toBeGreaterThan(-1)
  return textOf(markup.slice(markup.lastIndexOf('<', start)))
}

/** Any name of a login, in any words, such as "Uses your Claude login". */
const anyLogin = /login/i

/** The account of the reader of a role, with no agent login. */
function noLogins(role: OrgRole) {
  return { ...coreFixtures(role).account, agentLogins: [] }
}

/** The record of the first session, as the fake gives it. */
const firstRecord = () => workspaceFixtures().sessions.sessions[0]

describe('the login of a session', () => {
  it("names the starter's login inside the composer box to another member, also after the starter left the org, and no login to the starter, also a private one", async () => {
    const own = await renderChat({})
    expect(own.text()).not.toContain(loginLabel)
    expect(composerText(own.markup())).not.toMatch(anyLogin)
    const ownPrivate = await renderChat({
      setup: (server) => withSessions(server, loginPrivate),
    })
    ownPrivate.chat.controller.setDraft(id, 'Add tests.')
    expect(ownPrivate.text()).not.toContain(loginLabel)
    expect(composerText(ownPrivate.markup())).not.toMatch(anyLogin)
    expect(ownPrivate.text()).not.toContain('Your message starts a new session')
    expect(ownPrivate.markup()).not.toMatch(sendOff)
    const member = await renderChat({ role: 'member' })
    expect(beforeSend(member.markup())).toContain("Cal's login")
    const { members } = coreFixtures('member')
    const left = await renderChat({
      role: 'member',
      setup: (server) =>
        server.json('GET', membersPath(FAKE_IDS.org), {
          ...members,
          members: members.members.filter((item) => item.user.id !== 'cal'),
        }),
    })
    expect(left.text()).toContain("Cal's login")
  })

  it('follows the session record, not an older account, for the login of its own starter', async () => {
    const revoked = await renderChat({})
    revoked.chat.controller.setDraft(id, 'Add tests.')
    revoked.chat.emit({
      type: 'session.updated',
      session: loginGone(firstRecord()),
    })
    expect(revoked.text()).toContain('Connect Claude to use Opus 5.5')
    expect(revoked.markup()).toMatch(sendOff)
    const restored = await renderChat({
      setup: (server) =>
        server.json('GET', ACCOUNT_PATHS.account, noLogins('admin')),
    })
    restored.chat.controller.setDraft(id, 'Add tests.')
    expect(restored.text()).not.toContain('Connect Claude')
    expect(restored.markup()).not.toMatch(sendOff)
  })

  it("lets another member send on the starter's login, with no Connect notice, when the member has no own login", async () => {
    const member = await renderChat({
      role: 'member',
      setup: (server) =>
        server.json('GET', ACCOUNT_PATHS.account, noLogins('member')),
    })
    member.chat.controller.setDraft(id, 'Add tests.')
    expect(member.text()).toContain("Cal's login")
    expect(member.text()).not.toContain('Connect Claude')
    expect(member.markup()).not.toMatch(sendOff)
  })

  it('says before Send that a message starts a new session, and why, names no login, and offers no steering of the running turn', async () => {
    const reasons = [
      [loginGone, "Cal's Claude login is not available."],
      [loginPrivate, "Cal's Claude login is for Cal's messages only."],
    ] as const
    for (const [change, reason] of reasons) {
      const member = await renderChat({
        role: 'member',
        conversation: 'running',
        setup: (server) => withSessions(server, change),
      })
      member.chat.controller.setDraft(id, 'Show a loading state.')
      const text = member.text()
      expect({
        case: reason,
        notice: text.includes(`Your message starts a new session ${reason}`),
        label: text.includes(loginLabel),
        composerLogin: anyLogin.test(composerText(member.markup())),
        stop: text.includes('Stop'),
        steer: member
          .markup()
          .includes('placeholder="Steer the agent while it works"'),
        placeholder: member
          .markup()
          .includes('placeholder="Message the agent"'),
        sendOff: sendOff.test(member.markup()),
      }).toEqual({
        case: reason,
        notice: true,
        label: false,
        composerLogin: false,
        stop: true,
        steer: false,
        placeholder: true,
        sendOff: false,
      })
    }
  })

  it("names nobody for an older record, and asks for the reader's own login before a new session", async () => {
    const older = await renderChat({
      role: 'member',
      setup: (server) =>
        withSessions(server, (session) => ({
          ...session,
          startedBy: null,
          loginAvailable: false,
        })),
    })
    expect(older.text()).toContain(
      'Your message starts a new session The login for this session is not available.',
    )
    expect(older.text()).not.toContain(loginLabel)
    expect(composerText(older.markup())).not.toMatch(anyLogin)
    const noLogin = await renderChat({
      role: 'member',
      setup: (server) => {
        withSessions(server, loginGone)
        server.json('GET', ACCOUNT_PATHS.account, noLogins('member'))
      },
    })
    noLogin.chat.controller.setDraft(id, 'Add tests.')
    expect(noLogin.text()).toContain('Connect Claude to use Opus 5.5')
    expect(noLogin.text()).not.toContain('Your message starts a new session')
    expect(noLogin.markup()).toMatch(sendOff)
    const privateNoLogin = await renderChat({
      role: 'member',
      setup: (server) => {
        withSessions(server, loginPrivate)
        server.json('GET', ACCOUNT_PATHS.account, noLogins('member'))
      },
    })
    privateNoLogin.chat.controller.setDraft(id, 'Add tests.')
    expect(privateNoLogin.text()).toContain('Connect Claude to use Opus 5.5')
    expect(privateNoLogin.text()).not.toContain(loginLabel)
    expect(composerText(privateNoLogin.markup())).not.toMatch(anyLogin)
    expect(privateNoLogin.markup()).toMatch(sendOff)
  })

  it("asks for the reader's own Codex login before a new session while the app can no longer use it", async () => {
    const codex: AgentChoice = {
      agent: 'codex',
      model: 'GPT-6.1 Sol',
      effort: 'medium',
      fast: false,
    }
    const login = {
      agent: 'codex',
      connected: true,
      kind: 'token',
      noReuse: true,
      updatedAt: FAKE_TIME,
    } as const
    const cases = [
      ['signed out', { ...login, unusableCause: 'ChatGPT access expired.' }],
      ['usable', login],
    ] as const
    const shown = []
    for (const [name, own] of cases) {
      const member = await renderChat({
        role: 'member',
        setup: (server) => {
          withSessions(server, (session) => ({
            ...loginGone(session),
            choice: codex,
          }))
          server.json('GET', ACCOUNT_PATHS.account, {
            ...noLogins('member'),
            agentLogins: [own],
          })
        },
      })
      member.chat.controller.setDraft(id, 'Add tests.')
      const text = member.text()
      shown.push({
        case: name,
        connect: text.includes('Connect Codex to use GPT-6.1 Sol'),
        linked: text.includes('Your message starts a new session'),
        sendOff: sendOff.test(member.markup()),
      })
    }
    expect(shown).toEqual([
      { case: 'signed out', connect: true, linked: false, sendOff: true },
      { case: 'usable', connect: false, linked: true, sendOff: false },
    ])
  })
})
