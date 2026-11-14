import type { DeviceCommandRecord } from '../../shared/generated/DeviceCommandRecord'
import { ApiError } from '../../app/api/client'
import type { DeviceApprovalAction } from '../../shared/device'
import type { ChatSnapshot } from '../state/chat-snapshot'
import { showNotice, type ChatContext } from '../state/context'
import type { DeviceApi } from './device-api'
import {
  canAnswer,
  equalPairing,
  keptAnswers,
  type DeviceSnapshot,
} from './device-snapshot'

/** Numbers each read, so that only the reply of the latest read applies. */
export class DeviceReads {
  private count = 0

  next(): number {
    this.count += 1
    return this.count
  }

  isLatest(read: number): boolean {
    return read === this.count
  }
}

/** The routes of Mac commands, and the number of their latest read. */
export interface DeviceChannel {
  readonly api: DeviceApi
  readonly reads: DeviceReads
}

function withDevices(
  snapshot: ChatSnapshot,
  change: (devices: DeviceSnapshot) => DeviceSnapshot,
): ChatSnapshot {
  return { ...snapshot, devices: change(snapshot.devices) }
}

const settled = <T>(result: PromiseSettledResult<T>): T | null =>
  result.status === 'fulfilled' ? result.value : null

/**
 * Reads the Mac commands of the workspace and the pairing of this window.
 * The chat reads them when it loads and after each change of the workspace,
 * because the Worker records a workspace change with each change of a
 * request. A reply of an older read changes nothing. A failed read keeps
 * the requests that the chat shows, and takes away the choices, because
 * the pairing is then not known.
 */
export async function refreshDevices(context: ChatContext): Promise<void> {
  if (!context.live()) return
  const { api, reads } = context.devices
  const read = reads.next()
  context.store.update((snapshot) =>
    snapshot.devices.load === 'idle'
      ? withDevices(snapshot, (devices) => ({ ...devices, load: 'loading' }))
      : snapshot,
  )
  const [requests, pairing] = await Promise.allSettled([
    api.commands(context.target),
    api.current(),
  ])
  if (!context.live() || !reads.isLatest(read)) return
  const shown = settled(requests)
  const paired = settled(pairing)
  context.store.update((snapshot) =>
    withDevices(snapshot, (devices) => {
      if (shown === null || pairing.status === 'rejected') {
        return { ...devices, load: 'failed', pairing: null, answers: {} }
      }
      return {
        requests: shown,
        pairing: paired,
        load: 'ready',
        answers: keptAnswers(devices, shown, paired),
      }
    }),
  )
}

/** A request that no longer waits is no failure of the answer. */
const NOT_PENDING = 'device_request_not_pending'

function withoutAnswer(
  devices: DeviceSnapshot,
  requestId: string,
): DeviceSnapshot {
  return {
    ...devices,
    answers: Object.fromEntries(
      Object.entries(devices.answers).filter(([id]) => id !== requestId),
    ),
  }
}

function find(
  devices: DeviceSnapshot,
  requestId: string,
): DeviceCommandRecord | undefined {
  return devices.requests.find((request) => request.requestId === requestId)
}

/**
 * Sends the answer of the user to the Mac that got the request. The address
 * names the request by the key of its record, and the chat keeps its raw ID.
 * The Worker passes the answer on, and the Mac decides. So the answer stays marked until the
 * request changes. A failure clears the mark and names the cause, unless
 * the pairing changed in the meantime, which took the old choices away.
 */
export async function answerCommand(
  context: ChatContext,
  requestId: string,
  action: DeviceApprovalAction,
): Promise<void> {
  const devices = context.store.get().devices
  const request = find(devices, requestId)
  const { pairing } = devices
  if (!request || !pairing || !canAnswer(devices, request)) return
  if (Object.hasOwn(devices.answers, requestId)) return
  context.store.update((snapshot) =>
    withDevices(snapshot, (current) => ({
      ...current,
      answers: { ...current.answers, [requestId]: action },
    })),
  )
  try {
    await context.devices.api.answer(
      context.target,
      request.requestKey,
      pairing,
      action,
    )
  } catch (error) {
    if (!context.live()) return
    if (!equalPairing(context.store.get().devices.pairing, pairing)) return
    context.store.update((snapshot) =>
      withDevices(snapshot, (current) => withoutAnswer(current, requestId)),
    )
    const pending = error instanceof ApiError && error.code === NOT_PENDING
    if (!pending) {
      showNotice(
        context,
        request.sessionId,
        'The Mac did not get the answer',
        error,
      )
    }
    void refreshDevices(context)
  }
}
