import type { RunnerPortsUpdated } from '../../src/shared/generated/RunnerPortsUpdated'
import {
  PORT_FOLDER_MAX_CHARACTERS,
  PORT_NAME_MAX_CHARACTERS,
  PORT_REPORT_MAX_PORTS,
} from '../../src/shared/ports'
import { counter, invalidInput, record, string } from './inputs'

function label(value: unknown): string | null {
  if (value === null) return null
  return string(value)
}

export function parsePortReport(value: unknown): RunnerPortsUpdated {
  const input = record(value)
  if (!Array.isArray(input.ports) || input.ports.length > PORT_REPORT_MAX_PORTS)
    return invalidInput()
  let previous = 0
  const ports = input.ports.map((value: unknown) => {
    const input = record(value)
    const port = counter(input.port)
    if (port <= previous || port > 65535) return invalidInput()
    previous = port
    return {
      port,
      name: label(input.name),
      folder: label(input.folder),
    }
  })
  return { type: 'ports.updated', ports }
}

/** The workspace calls this only after complete-source secret filtering. */
export function displayPortReport(
  event: RunnerPortsUpdated,
): RunnerPortsUpdated {
  return {
    ...event,
    ports: event.ports.map((port) => {
      const folder = port.folder === null ? null : Array.from(port.folder)
      return {
        ...port,
        name:
          port.name === null
            ? null
            : Array.from(port.name).slice(0, PORT_NAME_MAX_CHARACTERS).join(''),
        folder:
          folder === null
            ? null
            : folder.length > PORT_FOLDER_MAX_CHARACTERS
              ? `…${folder.slice(-(PORT_FOLDER_MAX_CHARACTERS - 1)).join('')}`
              : port.folder,
      }
    }),
  }
}

export function checkDisplayedPortReport(event: RunnerPortsUpdated): void {
  for (const port of event.ports)
    if (
      (port.name !== null &&
        Array.from(port.name).length > PORT_NAME_MAX_CHARACTERS) ||
      (port.folder !== null &&
        Array.from(port.folder).length > PORT_FOLDER_MAX_CHARACTERS)
    )
      invalidInput()
}
