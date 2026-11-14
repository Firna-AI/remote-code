import type { ListeningPort } from '../shared/generated/ListeningPort'
import rows from '../../docs/mockups/src/components/tools/PortForm.module.css'
import {
  portFormCopy,
  serverDescription,
} from '../../docs/mockups/src/components/tools/previewCopy'
import styles from './PreviewOpenForm.module.css'

/**
 * The servers that listen in the sandbox: a button for each, with its port,
 * its program name, and its folder, when the report has them. A folder that
 * does not fit keeps its end, after "…". The tooltip and the spoken name
 * give the whole of each. A click opens the preview of the port. The
 * buttons wait while a preview opens, as Open preview does.
 */
export function ServerRows(props: {
  servers: readonly ListeningPort[]
  disabled: boolean
  onOpen: (port: number) => void
}) {
  return (
    <ul aria-label={portFormCopy.listLabel} className={rows.rows}>
      {props.servers.map((server) => {
        const description = serverDescription(server)
        return (
          <li key={server.port}>
            <button
              aria-label={description}
              className={`${rows.row} ${styles.row}`}
              disabled={props.disabled}
              onClick={() => props.onOpen(server.port)}
              title={description}
              type="button"
            >
              <span className={rows.number}>{server.port}</span>
              {server.name === null ? null : (
                <span className={rows.name}>{server.name}</span>
              )}
              {server.folder === null ? null : (
                <span className={rows.folder}>
                  <span dir="ltr">{server.folder}</span>
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
