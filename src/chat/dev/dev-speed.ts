import type { TurnSpeed } from '../../shared/generated/TurnSpeed'
import type { WorkspaceEventEnvelope } from '../../shared/events'
import { withUnreadFiles } from './dev-loss'
import type { DevOptions } from './dev-options'

/** The speed that each value of the `speed` option gives an end of a turn. */
const speeds: Readonly<
  Record<Exclude<DevOptions['speed'], 'none'>, TurnSpeed>
> = {
  fast: { state: 'fast' },
  limit: { state: 'standard', cause: 'fast_limit' },
  older: { state: 'standard', cause: 'older_runner' },
  other: { state: 'standard', cause: 'out_of_credits' },
}

/**
 * The `speed` option of the development page: each end of a turn of the
 * recorded chat gives the speed of a fast turn. With `none`, the turns
 * have no fast mode, as recorded.
 */
function withSpeed(
  events: readonly WorkspaceEventEnvelope[],
  speed: DevOptions['speed'],
): WorkspaceEventEnvelope[] {
  if (speed === 'none') return [...events]
  return events.map((envelope) =>
    envelope.event.type === 'turn.completed'
      ? { ...envelope, event: { ...envelope.event, speed: speeds[speed] } }
      : envelope,
  )
}

/** Whether the options change the recorded ends of the turns. */
export function changesTurnEnds(
  options: Pick<DevOptions, 'files' | 'speed'>,
): boolean {
  return options.files === 'unread' || options.speed !== 'none'
}

/** The recorded events, with each end of a turn as the options ask. */
export function withTurnEnds(
  events: readonly WorkspaceEventEnvelope[],
  options: Pick<DevOptions, 'files' | 'speed'>,
): WorkspaceEventEnvelope[] {
  const files = options.files === 'unread' ? withUnreadFiles(events) : events
  return withSpeed(files, options.speed)
}
