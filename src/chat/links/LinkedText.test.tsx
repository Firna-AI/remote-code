import type { Workspace } from '../../shared/generated/Workspace'
// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import { routes } from '../../app/router'

import { accessibleName } from '../../test-support/dom-queries'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { mount } from '../../test-support/mount'
import { AgentText } from '../components/AgentText'
import { LinksProvider } from './LinksContext'

const { org } = FAKE_IDS
const linked = workspaceFixtures().workspaces.workspaces[0] as Workspace

describe('workspace chips in an answer of the agent', () => {
  test('a Markdown link in a list or in bold text is the chip alone, also with a bold or code label, and a link in code stays code', async () => {
    const answer = [
      `Created **[W-${linked.number}](${linked.link})** for the fonts.`,
      '',
      `- Follow [the new workspace](${linked.link}) there.`,
      '',
      `Bold [**W-${linked.number}**](${linked.link}) and code [\`W-${linked.number}\`](${linked.link}) labels.`,
      '',
      `Run \`open ${linked.link}\` now, then **${linked.link}**.`,
      '',
      '```',
      `open ${linked.link}`,
      '```',
    ].join('\n')
    const { container } = await mount(
      <LinksProvider value={{ links: { orgId: org, workspaces: [linked] } }}>
        <AgentText text={answer} />
      </LinksProvider>,
    )
    const chips = Array.from(container.querySelectorAll('a'), (link) => ({
      in: link.parentElement?.tagName,
      to: link.getAttribute('href'),
      name: accessibleName(link),
    }))
    const chip = {
      to: routes.workspace(org, linked.id),
      name: `W-${linked.number} ${linked.name}, Starting`,
    }
    expect({
      chips,
      text: Array.from(
        container.querySelectorAll('p, li'),
        (part) => part.textContent,
      ),
      inlineCode: Array.from(
        container.querySelectorAll('p code'),
        (code) => code.textContent,
      ),
      code: container.querySelector('pre')?.textContent,
    }).toEqual({
      chips: [
        { in: 'STRONG', ...chip },
        { in: 'LI', ...chip },
        { in: 'P', ...chip },
        { in: 'P', ...chip },
        { in: 'STRONG', ...chip },
      ],
      text: [
        `Created ${chip.name} for the fonts.`,
        `Follow ${chip.name} there.`,
        `Bold ${chip.name} and code ${chip.name} labels.`,
        `Run open ${linked.link} now, then ${chip.name}.`,
      ],
      inlineCode: [`open ${linked.link}`],
      code: `open ${linked.link}`,
    })
  })
})
