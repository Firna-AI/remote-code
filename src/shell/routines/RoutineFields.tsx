import { useId, type ReactNode } from 'react'
import { Input } from '@firna/ui/input'
import { Switch } from '@firna/ui/switch'
import type { LucideIcon } from 'lucide-react'
import { ChevronDown, FolderGit2, Rows3 } from 'lucide-react'
import type { MessageSender } from '../../shared/generated/MessageSender'
import { useControlSizes } from '../../../docs/mockups/src/components/common/touch'
import form from '../../../docs/mockups/src/components/routines/form.module.css'
import styles from '../../../docs/mockups/src/components/routines/RoutineFields.module.css'
import { DetailList } from '../../../docs/mockups/src/components/settings/DetailList'
import { personName } from '../../app/people'
import type { RoutineDraft } from '../../app/routine-draft'
import { ActionButton } from '../ui/actions'
import { PersonAvatar } from '../ui/Avatars'
import { MenuButton } from '../ui/Menu'
import { useViewport } from '../ui/viewport'

/** A choice of a picker, such as a repository. */
export interface PickerChoice {
  id: string
  name: string
}

/** A menu button that picks a value, as the repository of New workspace. */
function Picker(props: {
  icon: LucideIcon
  name: string
  value: string
  choices: readonly PickerChoice[]
  chosen: string
  pick: (id: string) => void
}) {
  return (
    <span className={styles.picker}>
      <MenuButton
        entries={props.choices.map((choice) => ({
          kind: 'item',
          label: choice.name,
          checked: choice.id === props.chosen,
          onSelect: () => props.pick(choice.id),
        }))}
        label={props.name}
        placement="below-start"
        trigger={({ open, toggle }) => (
          <ActionButton
            accessibilityLabel={`${props.name}: ${props.value}`}
            expanded={open}
            icon={props.icon}
            menu
            onPress={toggle}
            trailing={
              <ChevronDown aria-hidden className={styles.chevron} size={13} />
            }
          >
            {props.value}
          </ActionButton>
        )}
      />
    </span>
  )
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <div className={form.field}>
      <span className={form.label}>{props.label}</span>
      {props.children}
    </div>
  )
}

/** The person whose logins the runs use, as "By Cal". */
function Creator(props: { owner: MessageSender }) {
  return (
    <span className={styles.by}>
      By
      <PersonAvatar person={props.owner} size={18} />
      <span className={styles.person}>{personName(props.owner)}</span>
    </span>
  )
}

/**
 * The name, the Active switch, the repository, and the section of the run
 * workspaces, which the owner changes, and "By" with the owner. An empty
 * name saves as "Untitled routine".
 */
export function RoutineFields(props: {
  draft: RoutineDraft
  change: (draft: RoutineDraft) => void
  owner: MessageSender
  /** The chosen repositories of the org, which a routine can use. */
  repositories: readonly PickerChoice[]
  /** The name of the repository of the draft, also when it is not chosen. */
  repositoryName: string
  sections: readonly PickerChoice[]
  orgName: string
}) {
  const { draft, change } = props
  const { field } = useControlSizes()
  const activeId = useId()
  const phone = useViewport() === 'phone'
  const section = props.sections.find((item) => item.id === draft.sectionId)
  return (
    <div className={styles.fields}>
      <div className={phone ? styles.stack : styles.top}>
        <div className={styles.name}>
          <Input
            label="Name"
            onChangeText={(name) => change({ ...draft, name })}
            placeholder="Untitled routine"
            size={field}
            value={draft.name}
          />
        </div>
        <div className={phone ? styles.switchRow : styles.switchField}>
          <span className={form.label} id={activeId}>
            Active
          </span>
          <Switch
            aria-labelledby={activeId}
            onValueChange={(active) => change({ ...draft, active })}
            size={field}
            value={draft.active}
          />
        </div>
      </div>
      <div className={phone ? styles.stack : styles.meta}>
        <Field label="Repository">
          {draft.repositoryId === '' ? (
            <p className={form.hint}>
              {`Choose the repositories of ${props.orgName} first.`}
            </p>
          ) : (
            <Picker
              chosen={draft.repositoryId}
              choices={props.repositories}
              icon={FolderGit2}
              name="Repository"
              pick={(repositoryId) => change({ ...draft, repositoryId })}
              value={props.repositoryName}
            />
          )}
        </Field>
        <Field label="Section">
          <Picker
            chosen={draft.sectionId}
            choices={props.sections}
            icon={Rows3}
            name="Section of the run workspaces"
            pick={(sectionId) => change({ ...draft, sectionId })}
            value={section?.name ?? draft.sectionId}
          />
        </Field>
        <Creator owner={props.owner} />
      </div>
      <p className={form.hint}>
        Each run opens a new workspace on a new branch of this repository, in
        this section.
      </p>
    </div>
  )
}

/** The same facts as another member reads them, who cannot change them. */
export function RoutineFacts(props: {
  active: boolean
  repositoryName: string
  sectionName: string
  owner: MessageSender
  /** The time zone, which shows while the routine has a schedule. */
  timeZone: string | null
}) {
  return (
    <DetailList
      rows={[
        { term: 'State', value: props.active ? 'Active' : 'Off' },
        { term: 'Repository', value: props.repositoryName },
        { term: 'Section', value: props.sectionName },
        { term: 'By', value: personName(props.owner) },
        ...(props.timeZone === null
          ? []
          : [{ term: 'Time zone', value: props.timeZone }]),
      ]}
    />
  )
}
