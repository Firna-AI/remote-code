import type { DeviceCommandRecord } from '../../shared/generated/DeviceCommandRecord'
import type { LucideIcon } from 'lucide-react'
import {
  Ban,
  CircleAlert,
  CircleCheck,
  CircleX,
  MonitorOff,
  TimerOff,
} from 'lucide-react'
import { deviceCommandSucceeded } from '../../shared/device'
import { stateLabel } from '../../shared/transcript/command-words'
import type { StatusTone } from '../../../docs/mockups/src/components/common/StatusText'

export interface StatePresentation {
  label: string
  tone: StatusTone
  icon?: LucideIcon
  busy?: boolean
}

function completed(
  request: DeviceCommandRecord,
  label: string,
): StatePresentation {
  if (deviceCommandSucceeded(request)) {
    return { label, tone: 'success', icon: CircleCheck }
  }
  if ((request.result?.exitCode ?? null) === null) {
    return { label, tone: 'warning', icon: CircleAlert }
  }
  return { label, tone: 'danger', icon: CircleX }
}

/** The state of a request as a glyph and a word, so it never needs colour. */
export function statePresentation(
  request: DeviceCommandRecord,
): StatePresentation {
  const label = stateLabel(request)
  switch (request.state) {
    case 'waiting':
    case 'running':
      return { label, tone: 'active', busy: true }
    case 'completed':
      return completed(request, label)
    case 'denied':
      return { label, tone: 'muted', icon: Ban }
    case 'unavailable':
      return { label, tone: 'warning', icon: MonitorOff }
    case 'timed-out':
      return { label, tone: 'warning', icon: TimerOff }
    case 'failed':
      return { label, tone: 'danger', icon: CircleAlert }
  }
}
