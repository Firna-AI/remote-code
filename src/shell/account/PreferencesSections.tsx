import { useState } from 'react'
import { SegmentedControl, type SegmentOption } from '@firna/ui/segmented'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import { useControlSizes } from '../../../docs/mockups/src/components/common/touch'
import styles from '../../../docs/mockups/src/components/settings/AccountSections.module.css'
import { Section } from '../../../docs/mockups/src/components/settings/Section'
import { useStore } from '../../app/store'
import type { NewWorkspaceView } from '../../shared/account'
import { useApp, useOfferedModels } from '../context'
import { ModelPicker } from '../ui/ModelPicker'
import { useAction } from '../ui/useAction'

const viewLabel = 'Open New workspace in'

const viewOptions: readonly SegmentOption<NewWorkspaceView>[] = [
  { label: 'Page', value: 'page' },
  { label: 'Dialog', value: 'dialog' },
]

/** The error of a choice whose save failed. The choice keeps its saved value. */
const choiceNotSaved = "The choice wasn't saved. Try again."

/**
 * The choice of how New workspace opens on a computer, with the helper line
 * that a phone always opens the page. Each change saves at once. The choice
 * shows the saved value, and it is off while its save runs. A failed save
 * shows its error under the choice until the next change.
 */
function NewWorkspaceViewChoice(props: { view: NewWorkspaceView }) {
  const app = useApp()
  const { field } = useControlSizes()
  const save = useAction((view: NewWorkspaceView) =>
    app.account.setNewWorkspaceView(view),
  )
  return (
    <SegmentedControl
      accessibilityLabel={viewLabel}
      disabled={save.pending}
      error={save.error ? choiceNotSaved : undefined}
      hint="A phone always opens the page."
      onChange={save.run}
      options={viewOptions}
      size={field}
      value={props.view}
    />
  )
}

/**
 * The New workspaces section of Preferences: the model and the effort that
 * new workspaces start with, and how New workspace opens. The picker hides
 * the models that the person's own endpoint does not list, and keeps the
 * model that it shows. Each change saves at once. While the model saves,
 * the picker shows the new choice and takes no other change, so the Fast
 * switch of its open menu shows its new state. A failed save of the model
 * shows a toast, and the picker shows the saved choice again. A failed save
 * of the choice shows its error under the choice.
 */
export function DefaultsSection() {
  const app = useApp()
  const account = useStore(app.account.account)
  const [requested, setRequested] = useState<AgentChoice | null>(null)
  const save = useAction(
    (choice: AgentChoice) => app.account.setDefaultChoice(choice),
    "The model wasn't saved.",
  )
  const saving = save.pending ? requested : null
  const models = useOfferedModels(saving ?? account?.defaultChoice)
  if (!account) return null
  const change = (choice: AgentChoice) => {
    if (save.pending) return
    setRequested(choice)
    save.run(choice)
  }
  return (
    <Section description="How you start new workspaces." title="New workspaces">
      <div className={styles.defaults}>
        <span className={styles.defaultsLabel}>Model and effort</span>
        <ModelPicker
          change={change}
          choice={saving ?? account.defaultChoice}
          disabled={save.pending}
          models={models}
          placement="below-start"
        />
        <span className={styles.defaultsLabel}>{viewLabel}</span>
        <div className={styles.defaultsWide}>
          <NewWorkspaceViewChoice view={account.newWorkspaceView} />
        </div>
      </div>
    </Section>
  )
}
