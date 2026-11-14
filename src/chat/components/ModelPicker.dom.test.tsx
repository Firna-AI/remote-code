import type { AgentModel } from '../../shared/generated/AgentModel'
// @vitest-environment happy-dom
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import {
  accessibleName,
  byRole,
  queryByRole,
} from '../../test-support/dom-queries'
import { mount, press, pressKey, type Mounted } from '../../test-support/mount'
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
  {
    agent: 'codex',
    model: 'sol',
    label: 'GPT-6.1 Sol',
    efforts: ['low', 'high'],
    fast: true,
  },
]

const opus: AgentChoice = {
  agent: 'claude',
  model: 'opus',
  effort: 'high',
  fast: false,
}

/**
 * What a screen reader says for each choice of the open picker. A browser
 * puts a space between the parts of a row, so the parts join with one.
 */
function spokenChoices(): string[] {
  const menu = byRole('menu', 'Model and effort')
  return Array.from(menu.querySelectorAll('[role="menuitemradio"]'), (item) =>
    Array.from(item.children, accessibleName).filter(Boolean).join(' '),
  )
}

/**
 * The picker of a session that takes each choice that the picker sends, as
 * the session shows a model change at once. `sent` keeps each choice.
 */
function Session(props: { start: AgentChoice; sent: AgentChoice[] }) {
  const [choice, setChoice] = useState(props.start)
  return (
    <ModelPicker
      choice={choice}
      models={models}
      onChoose={(next) => {
        props.sent.push(next)
        setChoice(next)
      }}
    />
  )
}

/** The trigger of the picker. */
function triggerOf(view: Mounted): HTMLElement {
  const button = view.container.querySelector('[aria-haspopup="menu"]')
  if (!(button instanceof HTMLElement)) throw new Error('No picker trigger')
  return button
}

/** What the trigger says to a screen reader, and the text that it shows. */
function triggerWords(view: Mounted) {
  const button = triggerOf(view)
  return { name: accessibleName(button), text: button.textContent }
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

describe('the model picker of a session with messages', () => {
  it('says New session for each model of the other agent only', async () => {
    await mount(
      <ModelPicker
        choice={opus}
        models={models}
        onChoose={() => undefined}
        sessionAgent="claude"
      />,
    )
    await press(byRole('button', 'Model and effort: Opus 5.5, High'))
    expect(spokenChoices()).toEqual([
      'Opus 5.5',
      'Sonnet 5.5',
      'GPT-6.1 Sol New session',
      'Low',
      'High',
    ])
  })
})

describe('the Fast switch of the model picker of a session', () => {
  it('ends the menu with a Fast row that the keys reach, changes only fast, keeps the menu open, and names Fast in the trigger', async () => {
    const sent: AgentChoice[] = []
    const view = await mount(<Session sent={sent} start={opus} />)
    await press(triggerOf(view))
    expect(rows().at(-1)).toEqual({
      role: 'menuitemcheckbox',
      name: 'Fast',
      on: 'false',
    })
    await pressKey('End')
    const reached = accessibleName(document.activeElement ?? document.body)
    await press(byRole('menuitemcheckbox', 'Fast'))
    expect({
      reached,
      sent,
      row: rows().at(-1),
      trigger: triggerWords(view),
    }).toEqual({
      reached: 'Fast',
      sent: [{ ...opus, fast: true }],
      row: { role: 'menuitemcheckbox', name: 'Fast', on: 'true' },
      trigger: {
        name: 'Model and effort: Opus 5.5, High, Fast',
        text: 'Opus 5.5HighFast',
      },
    })
  })

  it('keeps fast for a model with fast mode, turns it off for a model without, and shows no Fast row for that model', async () => {
    const sent: AgentChoice[] = []
    const view = await mount(
      <Session sent={sent} start={{ ...opus, fast: true }} />,
    )
    await press(triggerOf(view))
    await press(byRole('menuitemradio', 'GPT-6.1 Sol'))
    const sol = triggerWords(view).name
    await press(triggerOf(view))
    await press(byRole('menuitemradio', 'Sonnet 5.5'))
    const sonnet = triggerWords(view).name
    await press(triggerOf(view))
    expect({
      sent,
      sol,
      sonnet,
      roles: [...new Set(rows().map((row) => row.role))],
    }).toEqual({
      sent: [
        { agent: 'codex', model: 'sol', effort: 'high', fast: true },
        { agent: 'claude', model: 'sonnet', effort: 'high', fast: false },
      ],
      sol: 'Model and effort: GPT-6.1 Sol, High, Fast',
      sonnet: 'Model and effort: Sonnet 5.5, High',
      roles: ['menuitemradio'],
    })
  })
})
