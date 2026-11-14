import type { ListeningPort } from '../../../../src/shared/generated/ListeningPort'
import { previewPath } from '../../../../src/shared/previews'
import { appDomain } from '../brand'
import { orgs } from './orgs'
import { checkoutAutocomplete } from './workspaces'

/**
 * The port previews of the open workspace. The API gives each preview a
 * launch address on the app's hostname, never its private preview host.
 * The screens show the port, not the address.
 */

/** The port of the preview in the frame: the dev server of the terminal. */
export const openPort = 3000

/** The ports of the open previews, in the order of their tabs. */
export const openPorts: readonly number[] = [openPort, 6006]

/**
 * The servers that the runner detects in the sandbox, in the order of
 * their ports. The dev server runs in the root of `storefront`, the
 * workspace's repository, so it has no folder. `astro dev` runs in a folder
 * of `storefront` and in `marketing-site`, another repository of the org.
 * The playground has a long folder, and `storybook dev` has a name over 10
 * characters.
 */
export const detectedServers: readonly ListeningPort[] = [
  { port: openPort, name: 'next dev', folder: null },
  { port: 4321, name: 'astro dev', folder: 'docs' },
  { port: 4322, name: 'astro dev', folder: 'marketing-site' },
  {
    port: 5173,
    name: 'vite',
    folder: 'packages/address-autocomplete/examples/playground',
  },
  { port: 6006, name: 'storybook dev', folder: 'packages/ui' },
]

/**
 * A failed repair of the list (decision 96): a report of the servers was
 * lost, and the fresh full report was lost too, 3 minutes ago.
 */
export const serversUnavailable = { data: 'servers', ago: '3m ago' } as const

/** The launch address of the open preview, which a new tab opens. */
export const previewUrl = new URL(
  previewPath(orgs.acme.key, checkoutAutocomplete.key, 'preview-1'),
  `https://${appDomain}`,
).href

/** What the user types into the address field of the previewed shop. */
export const addressQuery = '221B Baker St'

export const addressSuggestions = [
  '221B Baker Street, London NW1 6XE',
  '221B Baker Street, Bristol BS1 4QA',
  '221 Baker Road, Leeds LS6 2AA',
] as const
