import type { DeviceCommandRecord } from '../../../src/shared/generated/DeviceCommandRecord.js'

import { nameLabel } from '../../../src/shared/name-label.ts'
import { DESKTOP_ORIGIN } from '../../../worker/security/desktop-contract.js'

interface NativeNotice {
  on(event: 'click', callback: () => void): unknown
  show(): void
  close(): void
}
interface NotificationDependencies {
  foreground(): boolean
  create(options: { title: string; body: string }): NativeNotice | undefined
  open(request: DeviceCommandRecord): void
  warn(): void
}

function compact(text: string, length: number): string {
  const characters = Array.from(text, (character) => {
    const code = character.codePointAt(0) ?? 0
    return code < 32 || code === 127 ? ' ' : character
  })
  return characters.length > length
    ? characters.slice(0, length - 1).join('') + '…'
    : characters.join('')
}

export function workspaceDeviceAddress(request: DeviceCommandRecord): string {
  const url = new URL(
    `${DESKTOP_ORIGIN}/orgs/${encodeURIComponent(request.orgId)}/workspaces/${encodeURIComponent(request.workspaceId)}`,
  )
  url.searchParams.set('sessionId', request.sessionId)
  url.searchParams.set('deviceRequestId', request.requestKey)
  return url.href
}

/** A notification opens the pending request. It has no approval action. */
export function notifyCommand(
  request: DeviceCommandRecord,
  dependencies: NotificationDependencies,
): () => void {
  if (dependencies.foreground()) return () => {}
  let active = true
  let notification: NativeNotice | undefined
  try {
    notification = dependencies.create({
      title: 'Run a command on this Mac?',
      body: `An agent in ${compact(nameLabel(request.workspaceName), 80)} asks to run ${compact(request.command, 160)}.`,
    })
    notification?.on('click', () => {
      if (active) dependencies.open(request)
    })
    notification?.show()
  } catch {
    dependencies.warn()
  }
  return () => {
    active = false
    try {
      notification?.close()
    } catch {
      dependencies.warn()
    }
  }
}
