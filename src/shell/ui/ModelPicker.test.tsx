// @vitest-environment happy-dom

import { useState } from 'react'
import { describe, expect, test } from 'vitest'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import type { AgentModel } from '../../shared/generated/AgentModel'
import {
  accessibleName,
  byRole,
  queryByRole,
} from '../../test-support/dom-queries'
import { mount, press, type Mounted } from '../../test-support/mount'
import { ModelPicker } from './ModelPicker'

const models: readonly AgentModel[] = [
  {
    agent: 'claude',
    model: 'opus',
    label: 'Opus 5.5',
    efforts: ['low', 'high'],
    fast: true,
  },
  {
    agent: 'claude',
    model: 'sonnet',
    label: 'Sonnet 5.5',
    efforts: ['low', 'high'],
  },
]

/**
 * The picker of a form, such as Preferences or New workspace, that takes
 * each choice that the picker gives. `changes` keeps each choice.
 */
function Form(props: { changes: AgentChoice[] }) {
  const [choice, setChoice] = useState<AgentChoice>({
    agent: 'claude',
    model: 'opus',
    effort: 'high',
    fast: false,
  })
  return (
    <ModelPicker
      change={(next) => {
        props.changes.push(next)
        setChoice(next)
      }}
      choice={choice}
      models={models}
    />
  )
}

/** The trigger of the picker. */
function triggerOf(view: Mounted): HTMLElement {
  const button = view.container.querySelector('[aria-haspopup="menu"]')
  if (!(button instanceof HTMLElement)) throw new Error('No picker trigger')
  return button
}

/**
 * Each row of the open menu: its role, its name, and whether it is on. A
 * closed menu has no rows.
 */
function rows() {
  const menu = queryByRole('menu', 'Model and effort')
  return Array.from(
    menu?.querySelectorAll('[role^="menuitem"]') ?? [],
    (row) => ({
      role: row.getAttribute('role'),
      name: accessibleName(row),
      on: row.getAttribute('aria-checked'),
    }),
  )
}

describe('the model picker of the shell', () => {
  test('a model with fast mode ends its menu with a Fast row that keeps the menu open, the trigger names Fast, and a model without fast mode turns it off', async () => {
    const changes: AgentChoice[] = []
    const view = await mount(<Form changes={changes} />)
    await press(triggerOf(view))
    expect(rows().at(-1)).toEqual({
      role: 'menuitemcheckbox',
      name: 'Fast',
      on: 'false',
    })
    await press(byRole('menuitemcheckbox', 'Fast'))
    const trigger = triggerOf(view)
    expect({
      row: rows().at(-1),
      name: accessibleName(trigger),
      text: trigger.textContent,
    }).toEqual({
      row: { role: 'menuitemcheckbox', name: 'Fast', on: 'true' },
      name: 'Model and effort: Opus 5.5, High, Fast',
      text: 'Opus 5.5HighFast',
    })
    await press(byRole('menuitemradio', 'Sonnet 5.5'))
    const sonnet = accessibleName(triggerOf(view))
    await press(triggerOf(view))
    expect({
      sonnet,
      changes,
      roles: [...new Set(rows().map((item) => item.role))],
    }).toEqual({
      sonnet: 'Model and effort: Sonnet 5.5, High',
      changes: [
        { agent: 'claude', model: 'opus', effort: 'high', fast: true },
        { agent: 'claude', model: 'sonnet', effort: 'high', fast: false },
      ],
      roles: ['menuitemradio'],
    })
  })
})
