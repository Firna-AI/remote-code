import type { Preview } from '../shared/generated/Preview'
import { ExternalLink } from 'lucide-react'

import styles from './PreviewFrame.module.css'

/**
 * What the previewed app may do in its frame. It keeps its own origin, so its
 * cookies and storage work, but it can't navigate the app's page. The launch
 * page that the frame loads first needs scripts, forms, and its own origin
 * too. Without that origin, its form posts `Origin: null`, and the authorizer
 * refuses it. No `allow-top-navigation` flag may join the list.
 */
const previewSandbox = [
  'allow-downloads',
  'allow-forms',
  'allow-modals',
  'allow-pointer-lock',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-presentation',
  'allow-same-origin',
  'allow-scripts',
  'allow-storage-access-by-user-activation',
].join(' ')

/**
 * A preview in a frame. Its address is the preview's launch page on the app
 * origin. The app session guards that page, so the address holds no secret.
 * Each load, also a reload, gives the frame its own preview cookie.
 */
export function PreviewFrame(props: { preview: Preview }) {
  return (
    <iframe
      className={styles.frame}
      referrerPolicy="no-referrer"
      sandbox={previewSandbox}
      src={props.preview.url}
      title={`Preview of port ${props.preview.port}`}
    />
  )
}

/**
 * Opens the same launch page in a new tab. The tab gets its own preview
 * cookie, and the previewed app keeps its own cookies there. The link shows
 * "Open", and its spoken name also says that a new tab opens.
 */
export function OpenInNewTab(props: { preview: Preview }) {
  return (
    <a
      aria-label="Open in new tab"
      className={styles.link}
      href={props.preview.url}
      referrerPolicy="no-referrer"
      rel="noopener noreferrer"
      target="_blank"
    >
      Open
      <ExternalLink aria-hidden size={12} />
    </a>
  )
}
