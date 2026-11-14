import type { DeviceCommandRecord } from '../../shared/generated/DeviceCommandRecord'
import type { DevicePairing } from '../../shared/generated/DevicePairing'
import type { DeviceApprovalAction } from '../../shared/device'

/** The Mac commands of one workspace, as this window knows them. */
export interface DeviceSnapshot {
  /** Every request of the workspace, the oldest first. */
  requests: readonly DeviceCommandRecord[]
  /**
   * The pairing of this window with the connection of its Mac. It is null
   * in a browser, in a window that is not paired, and until it loads.
   */
  pairing: DevicePairing | null
  /** The last read. A failed read keeps the requests of the read before. */
  load: 'idle' | 'loading' | 'ready' | 'failed'
  /**
   * The choice that this window sent for each request that still waits.
   * Only a later state of the request shows what the Mac did.
   */
  answers: Readonly<Record<string, DeviceApprovalAction>>
}

export const initialDevices: DeviceSnapshot = {
  requests: [],
  pairing: null,
  load: 'idle',
  answers: {},
}

/** Two pairings name the same connection. Two unknown pairings are equal. */
export function equalPairing(
  left: DevicePairing | null,
  right: DevicePairing | null,
): boolean {
  if (left === null || right === null) return left === right
  return (
    left.deviceId === right.deviceId && left.connectionId === right.connectionId
  )
}

/** This window is the Mac app on the Mac that got the request. */
function isThisMac(
  devices: DeviceSnapshot,
  request: DeviceCommandRecord,
): boolean {
  return (
    devices.pairing !== null && equalPairing(devices.pairing, request.device)
  )
}

/**
 * Only the Mac app on the Mac that got the request can answer it, and only
 * while the request waits.
 */
export function canAnswer(
  devices: DeviceSnapshot,
  request: DeviceCommandRecord,
): boolean {
  return request.state === 'waiting' && isThisMac(devices, request)
}

/** The choice that this window sent for a request, or null. */
export function answerOf(
  devices: DeviceSnapshot,
  requestId: string,
): DeviceApprovalAction | null {
  return Object.hasOwn(devices.answers, requestId)
    ? devices.answers[requestId]
    : null
}

/** The requests of one session, the oldest first. */
export function requestsOf(
  devices: DeviceSnapshot,
  sessionId: string | null,
): DeviceCommandRecord[] {
  return devices.requests.filter((request) => request.sessionId === sessionId)
}

/**
 * Keeps the answers of the requests that still wait. A new pairing drops
 * every answer, because the old connection can no longer act on it.
 */
export function keptAnswers(
  devices: DeviceSnapshot,
  requests: readonly DeviceCommandRecord[],
  pairing: DevicePairing | null,
): DeviceSnapshot['answers'] {
  if (!equalPairing(devices.pairing, pairing)) return {}
  const waiting = new Set(
    requests
      .filter((request) => request.state === 'waiting')
      .map((request) => request.requestId),
  )
  return Object.fromEntries(
    Object.entries(devices.answers).filter(([id]) => waiting.has(id)),
  )
}
