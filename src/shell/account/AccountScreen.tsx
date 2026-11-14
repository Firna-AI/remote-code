import { useMemo } from 'react'
import type { Agent } from '../../shared/generated/Agent'
import { routes, type AccountTab } from '../../app/router'
import { useServices } from '../../app/services'
import { ThisMacSection } from '../../chat/device/ThisMacSection'
import type { User } from '../../shared/api'
import { Page } from '../layout/Page'
import { useMacApp } from '../mac/mac-app'
import { LinkTabs } from '../ui/links'
import { useViewport } from '../ui/viewport'
import { AgentsSection, SignInSection } from './AccountSections'
import { DeletedOrgsSection } from './DeletedOrgsSection'
import { GitHubSection } from './GitHubSection'
import { InviteCodeSection } from './InviteCodeSection'
import { DefaultsSection } from './PreferencesSections'
import { ShortcutsTab } from './shortcuts/ShortcutsTab'

/**
 * The tabs of the account, in their order. Only the Mac app has This Mac,
 * so it comes last, and the other tabs keep their places in a browser.
 */
const tabs = [
  { tab: 'general', label: 'General' },
  { tab: 'agents', label: 'Agents' },
  { tab: 'preferences', label: 'Preferences' },
  { tab: 'shortcuts', label: 'Keyboard shortcuts' },
  { tab: 'this-mac', label: 'This Mac' },
] as const satisfies readonly { tab: AccountTab; label: string }[]

/** The content of a tab of the account. */
function TabContent(props: {
  tab: AccountTab
  user: User
  connect: Agent | null
}) {
  switch (props.tab) {
    case 'general':
      return <GeneralTab user={props.user} />
    case 'agents':
      return <AgentsSection connect={props.connect} />
    case 'preferences':
      return <DefaultsSection />
    case 'shortcuts':
      return <ShortcutsTab />
    case 'this-mac':
      return <ThisMac />
  }
}

/**
 * The This Mac tab, in the account of the Mac app only: the Mac that the
 * app registers, the commands that always run on it, and the permission grants of
 * each workspace. `AccountScreen` shows the tab only in the Mac app, so a
 * browser sends no request to a Mac.
 */
function ThisMac() {
  const services = useServices()
  const clock = useMemo(() => ({ now: services.now }), [services])
  const viewport = useViewport()
  return (
    <ThisMacSection
      client={services.api}
      clock={clock}
      viewport={viewport === 'phone' ? 'mobile' : 'desktop'}
    />
  )
}

/**
 * The General tab: the GitHub sign-in, the GitHub App that every org
 * shares, and the invite code of the user. The deleted orgs of the user
 * come last, with Restore, only while one exists.
 */
function GeneralTab(props: { user: User }) {
  return (
    <>
      <SignInSection user={props.user} />
      <GitHubSection />
      <InviteCodeSection />
      <DeletedOrgsSection />
    </>
  )
}

/**
 * The account, in four tabs, and five in the Mac app. Each tab is a link with its own address.
 * General holds the GitHub sign-in, the GitHub App, and the invite code of
 * the user. Agents holds the logins of Claude and Codex, which every org
 * shares. `connect` opens the Connect form of an agent at first, as the
 * link of a missing login does. Preferences holds how new workspaces
 * start: their model, and how New workspace opens. Keyboard shortcuts
 * holds the keys of the commands. A phone moves a tab that does not fit to a second line.
 * The Mac app adds This Mac last. A browser shows General at its address.
 * The product is free, so the page shows no plan and no billing.
 */
export function AccountScreen(props: {
  user: User
  tab: AccountTab
  connect: Agent | null
}) {
  const phone = useViewport() === 'phone'
  const mac = useMacApp()
  const tab = props.tab === 'this-mac' && !mac ? 'general' : props.tab
  return (
    <Page
      back={{ label: 'Workspaces', to: routes.home() }}
      subtitle={`@${props.user.githubLogin}`}
      tabs={
        <LinkTabs
          flow={phone}
          label="Account"
          tabs={tabs
            .filter((item) => mac || item.tab !== 'this-mac')
            .map((item) => ({
              label: item.label,
              to: routes.accountTab(item.tab),
              selected: item.tab === tab,
            }))}
        />
      }
      title="Account"
    >
      <TabContent connect={props.connect} tab={tab} user={props.user} />
    </Page>
  )
}
