import type { DeviceCommandRecord } from '../../../src/shared/generated/DeviceCommandRecord.js'
import type { DevicePairing } from '../../../src/shared/generated/DevicePairing.js'
import type {
  DeviceCommandRef,
  DeviceToWorker,
  WorkerToDevice,
} from '../../../src/shared/device.ts'
import { AlwaysAllowLimitError, type PermissionStore } from './permissions.js'
import { validCommand } from './runner.js'
import type { CommandRun } from './runner.js'
import { applyDeviceSettings } from './settings.js'

interface SessionDependencies {
  userId: string
  pairing: DevicePairing
  permissions: PermissionStore
  run(request: DeviceCommandRecord): CommandRun
  send(message: DeviceToWorker): boolean
  notify(request: DeviceCommandRecord): () => void
  invalid(): void
  warn(): void
}
interface LocalRequest {
  request: DeviceCommandRecord
  state: 'pending' | 'running' | 'terminal'
  cancel?: () => void
  dismiss?: () => void
}

const requestKey = (reference: DeviceCommandRef) =>
  JSON.stringify([reference.workspaceId, reference.requestId])
const reference = (request: DeviceCommandRecord): DeviceCommandRef => ({
  workspaceId: request.workspaceId,
  requestId: request.requestId,
})

/** One authenticated pairing owns all requests and approval operation IDs. */
export function createDeviceSession(dependencies: SessionDependencies) {
  const requests = new Map<string, LocalRequest>()
  const operations = new Set<string>()
  let disposed = false
  const finish = (entry: LocalRequest) => {
    entry.state = 'terminal'
    entry.cancel = undefined
    entry.dismiss?.()
    entry.dismiss = undefined
  }
  const execute = (entry: LocalRequest) => {
    finish(entry)
    if (
      !dependencies.send({
        type: 'command.approved',
        ...reference(entry.request),
      })
    )
      return
    entry.state = 'running'
    const run = dependencies.run(entry.request)
    entry.cancel = run.cancel
    void run.result
      .then((outcome) => {
        if (disposed || entry.state !== 'running') return
        finish(entry)
        if (outcome.type === 'result')
          dependencies.send({
            type: 'command.result',
            ...reference(entry.request),
            result: outcome.result,
          })
        if (outcome.type === 'failed')
          dependencies.send({
            type: 'command.failed',
            ...reference(entry.request),
            message: outcome.message,
          })
      })
      .catch(() => {
        if (disposed || entry.state !== 'running') return
        finish(entry)
        dependencies.send({
          type: 'command.failed',
          ...reference(entry.request),
          message: 'The Mac could not run the command. Try again.',
        })
      })
  }
  return {
    receive(message: WorkerToDevice): void {
      if (disposed) return
      if (message.type === 'command.request') {
        const request = message.request
        if (
          request.device?.deviceId !== dependencies.pairing.deviceId ||
          request.device.connectionId !== dependencies.pairing.connectionId ||
          request.sender.id !== dependencies.userId
        ) {
          dependencies.invalid()
          return
        }
        const existing = requests.get(requestKey(request))
        if (existing) {
          if (JSON.stringify(existing.request) !== JSON.stringify(request))
            dependencies.invalid()
          return
        }
        const entry: LocalRequest = { request, state: 'pending' }
        requests.set(requestKey(request), entry)
        if (!validCommand(request)) {
          finish(entry)
          dependencies.send({
            type: 'command.failed',
            ...reference(request),
            message: 'The Mac command request is invalid.',
          })
        } else if (
          dependencies.permissions.permits(request.command, request.workspaceId)
        ) {
          execute(entry)
        } else {
          entry.dismiss = dependencies.notify(request)
        }
      }
      if (message.type === 'command.cancel') {
        const entry = requests.get(requestKey(message))
        if (entry) {
          const cancel = entry.cancel
          finish(entry)
          cancel?.()
        }
      }
      if (message.type === 'command.approval') {
        if (operations.has(message.operationId)) return
        operations.add(message.operationId)
        const entry = requests.get(requestKey(message))
        if (!entry || entry.state !== 'pending') return
        if (message.action === 'deny') {
          finish(entry)
          dependencies.send({
            type: 'command.denied',
            ...reference(entry.request),
          })
          return
        }
        try {
          if (message.action === 'always-allow')
            dependencies.permissions.allowCommand(entry.request.command)
          if (message.action === 'allow-workspace-15-minutes')
            dependencies.permissions.allowWorkspace(
              entry.request.workspaceId,
              entry.request.workspaceName,
            )
          if (message.action === 'allow-workspace-until-stop')
            dependencies.permissions.allowWorkspaceUntilStop(
              entry.request.workspaceId,
              entry.request.workspaceName,
            )
          execute(entry)
        } catch (error) {
          finish(entry)
          let message = 'The Mac could not save this permission. Try again.'
          if (error instanceof AlwaysAllowLimitError) message = error.message
          else dependencies.warn()
          dependencies.send({
            type: 'command.failed',
            ...reference(entry.request),
            message,
          })
        }
      }
      if (message.type === 'settings.operation') {
        if (operations.has(message.operationId)) return
        operations.add(message.operationId)
        applyDeviceSettings(message, dependencies)
      }
    },
    dispose(): void {
      disposed = true
      requests.forEach((entry) => {
        const cancel = entry.cancel
        finish(entry)
        cancel?.()
      })
      requests.clear()
      operations.clear()
    },
  }
}

export type DeviceSession = ReturnType<typeof createDeviceSession>
