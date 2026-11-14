import type { ListeningPort } from './generated/ListeningPort'
export const PORT_REPORT_MAX_PORTS = 64
export const PORT_NAME_MAX_CHARACTERS = 40
export const PORT_FOLDER_MAX_CHARACTERS = 120

export interface PortsUpdated {
  type: 'ports.updated'
  /** Final filtered display labels. Null means that this workspace has no current runner report. */
  ports: readonly ListeningPort[] | null
}
