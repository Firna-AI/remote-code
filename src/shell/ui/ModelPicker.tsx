import type { AgentModel } from '../../shared/generated/AgentModel'
import { Button } from '@firna/ui/button'
import { ChevronDown } from 'lucide-react'
import type { Agent } from '../../shared/generated/Agent'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import type { Effort } from '../../shared/generated/Effort'
import type { MenuPlacement } from '../../../docs/mockups/src/components/common/Menu'
import { useControlSizes } from '../../../docs/mockups/src/components/common/touch'
import { pickerButtonStyle } from '../../../docs/mockups/src/components/chat/pickerButton'
import styles from '../../../docs/mockups/src/components/chat/ModelPicker.module.css'
import { EFFORTS } from '../../app/api/read-core'
import { effortLabels, findModel, modelLabel } from '../../shared/agents'
import { fastFor } from '../../chat/state/format'
import { MenuButton, type MenuEntry } from './Menu'

/** The effort that a new model keeps: the same one, or the next lower one. */
function effortFor(model: AgentModel, effort: Effort): Effort {
  if (model.efforts.includes(effort)) return effort
  const lower = EFFORTS.slice(0, EFFORTS.indexOf(effort)).reverse()
  return lower.find((item) => model.efforts.includes(item)) ?? model.efforts[0]
}

/**
 * The models of each agent, the efforts of the chosen model, and the Fast
 * switch of a model that the model list marks as fast. A model keeps fast
 * mode only when it has fast mode. The switch keeps the menu open.
 */
function entries(
  models: readonly AgentModel[],
  choice: AgentChoice,
  change: (choice: AgentChoice) => void,
): MenuEntry[] {
  const agents: readonly Agent[] = ['claude', 'codex']
  const groups = agents.flatMap((agent, index): MenuEntry[] => {
    const own = models.filter((item) => item.agent === agent)
    if (own.length === 0) return []
    return [
      ...(index > 0 ? [{ kind: 'divider' } as const] : []),
      ...own.map((item): MenuEntry => ({
        kind: 'item',
        label: item.label,
        checked: item.agent === choice.agent && item.model === choice.model,
        onSelect: () =>
          change({
            agent: item.agent,
            model: item.model,
            effort: effortFor(item, choice.effort),
            fast: fastFor(item, choice.fast),
          }),
      })),
    ]
  })
  const current = findModel(models, choice)
  const efforts = (current?.efforts ?? []).map((effort): MenuEntry => ({
    kind: 'item',
    label: effortLabels[effort],
    checked: effort === choice.effort,
    onSelect: () => change({ ...choice, effort }),
  }))
  if (efforts.length === 0) return groups
  const fast: MenuEntry[] = current?.fast
    ? [
        { kind: 'divider' },
        {
          kind: 'switch',
          label: 'Fast',
          on: choice.fast,
          onToggle: () => change({ ...choice, fast: !choice.fast }),
        },
      ]
    : []
  return [
    ...groups,
    { kind: 'divider' },
    { kind: 'label', label: 'Effort' },
    ...efforts,
    ...fast,
  ]
}

/**
 * One picker for the model and the effort, such as "Opus 5.5 High", with
 * "Fast" after the effort while fast mode is on. It names no agent brand.
 * It shows fast mode as off for a model that the model list does not mark
 * as fast.
 */
export function ModelPicker(props: {
  models: readonly AgentModel[]
  choice: AgentChoice
  change: (choice: AgentChoice) => void
  placement?: Exclude<MenuPlacement, 'sheet'>
  /**
   * The picker takes no change, such as while one saves. The trigger and
   * the rows of an open menu are off, and an open menu stays open.
   */
  disabled?: boolean
}) {
  const control = useControlSizes()
  const choice: AgentChoice = {
    ...props.choice,
    fast: fastFor(findModel(props.models, props.choice), props.choice.fast),
  }
  const model = modelLabel(props.models, choice)
  const effort = effortLabels[choice.effort]
  return (
    <MenuButton
      busy={props.disabled}
      className={styles.anchor}
      entries={entries(props.models, choice, props.change)}
      label="Model and effort"
      placement={props.placement ?? 'above-start'}
      trigger={({ open, toggle, busy }) => (
        <Button
          accessibilityLabel={`Model and effort: ${model}, ${effort}${choice.fast ? ', Fast' : ''}`}
          content={
            <span
              className={styles.trigger}
              style={{ fontSize: control.labelSize }}
            >
              <span className={styles.model}>{model}</span>
              <span className={styles.effort}>{effort}</span>
              {choice.fast ? <span className={styles.fast}>Fast</span> : null}
              <ChevronDown aria-hidden className={styles.chevron} size={12} />
            </span>
          }
          disabled={busy}
          expanded={open}
          hasPopup="menu"
          onPress={toggle}
          size="sm"
          style={pickerButtonStyle(control.height)}
          tone="plain"
        />
      )}
    />
  )
}
