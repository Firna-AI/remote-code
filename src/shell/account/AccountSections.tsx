import { LogOut } from 'lucide-react'
import type { Agent } from '../../shared/generated/Agent'
import styles from '../../../docs/mockups/src/components/settings/AccountSections.module.css'
import { Section } from '../../../docs/mockups/src/components/settings/Section'
import type { User } from '../../shared/api'
import { useApp } from '../context'
import { ActionButton } from '../ui/actions'
import { PersonAvatar } from '../ui/Avatars'
import { useAction } from '../ui/useAction'
import { AgentList } from './AgentList'

/** The person signed in, with GitHub, and the way to sign out. */
export function SignInSection(props: { user: User }) {
  const app = useApp()
  const signOut = useAction(
    () => app.account.signOut(),
    "You weren't signed out.",
  )
  return (
    <section aria-label="Sign-in" className={styles.signIn}>
      <PersonAvatar person={props.user} size={32} />
      <span className={styles.signInText}>
        Signed in with GitHub as{' '}
        <span className={styles.login}>@{props.user.githubLogin}</span>
      </span>
      <ActionButton busy={signOut.pending} icon={LogOut} onPress={signOut.run}>
        Sign out
      </ActionButton>
    </section>
  )
}

/**
 * The agents that every org uses, Claude and Codex: each connected login
 * with its kind, Remove, and its share setting, or Connect, which opens
 * the form of the agent. `connect` opens the form of that agent at first,
 * as the link of a missing login does.
 */
export function AgentsSection(props: { connect: Agent | null }) {
  return (
    <Section description="Every org uses these agents." title="Agents">
      <AgentList
        closable
        initial={props.connect}
        key={props.connect ?? 'none'}
        removable
        shares
      />
    </Section>
  )
}
