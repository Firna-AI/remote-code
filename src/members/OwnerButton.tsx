import type { Workspace } from '../shared/generated/Workspace'
import { ChevronDown } from 'lucide-react'
import { Button } from '@firna/ui/button'

import { personName } from './people'
import type { MenuTriggerProps } from './ui/ChoiceMenu'
import { useControlSizes } from './ui/controls'
import { PersonAvatar } from './ui/PersonAvatar'
import a11y from './ui/a11y.module.css'
import styles from './OwnerPicker.module.css'

/** The owner as a member who is not an admin sees it: without the menu. */
export function ReadOnlyOwner(props: {
  workspace: Workspace
  compact: boolean
}) {
  const { owner } = props.workspace
  const name = personName(owner)
  return (
    <span className={styles.plain} title={`Owner: ${name}`}>
      <PersonAvatar person={owner} size={props.compact ? 24 : 18} />
      {props.compact ? null : <span className={styles.name}>{name}</span>}
      <span className={a11y.hidden}>
        {props.compact
          ? `${name}, owner of the workspace`
          : ', owner of the workspace'}
      </span>
    </span>
  )
}

/**
 * The button that opens the owner menu: the avatar and the name, or the
 * avatar alone on a phone.
 */
export function OwnerButton(props: {
  workspace: Workspace
  compact: boolean
  busy: boolean
  trigger: MenuTriggerProps
}) {
  const control = useControlSizes()
  const { owner } = props.workspace
  const name = personName(owner)
  const content = props.compact ? (
    <PersonAvatar person={owner} size={24} />
  ) : (
    <span className={styles.trigger} style={{ fontSize: control.labelSize }}>
      <PersonAvatar person={owner} size={18} />
      <span className={styles.name}>{name}</span>
      <ChevronDown aria-hidden className={styles.chevron} size={12} />
    </span>
  )
  return (
    <Button
      accessibilityLabel={`Owner: ${name}`}
      boxSize={props.compact ? control.height : undefined}
      busy={props.busy}
      buttonRef={props.trigger.buttonRef}
      content={content}
      expanded={props.trigger.expanded}
      hasPopup="menu"
      onPress={props.trigger.onPress}
      shape={props.compact ? 'square' : undefined}
      size="sm"
      style={
        props.compact
          ? undefined
          : { height: control.height, paddingHorizontal: 6 }
      }
      tone="plain"
    />
  )
}
