import type { DeviceCommandInput } from '../../../src/shared/generated/DeviceCommandInput.js'
import type { DeviceCommandResult } from '../../../src/shared/generated/DeviceCommandResult.js'

import type { DeviceClock } from './clock.js'
import { captureOutput } from './output.js'
import type { CommandProcess, LaunchCommand } from './process.js'

export type CommandOutcome =
  | { type: 'result'; result: DeviceCommandResult }
  | { type: 'failed'; message: string }
  | { type: 'cancelled' }
interface RunnerDependencies {
  clock: DeviceClock
  launch: LaunchCommand
}
type LocalCommand = Pick<
  DeviceCommandInput,
  'command' | 'folder' | 'reason' | 'timeoutSeconds'
> & { longerTimeoutReason?: string | null }

export function validCommand(input: LocalCommand): boolean {
  const timeout = input.timeoutSeconds ?? 60
  return (
    [input.command, input.folder, input.reason].every(
      (value) =>
        typeof value === 'string' &&
        value.trim().length > 0 &&
        !value.includes('\0'),
    ) &&
    Number.isInteger(timeout) &&
    timeout > 0 &&
    timeout <= 1800 &&
    (timeout <= 120 ||
      (typeof input.longerTimeoutReason === 'string' &&
        input.longerTimeoutReason.trim().length > 0))
  )
}

export function runCommand(
  input: LocalCommand,
  dependencies: RunnerDependencies,
) {
  let process: CommandProcess | undefined
  let cancelTimer: (() => void) | undefined
  let finished = false
  let resolve: (outcome: CommandOutcome) => void = () => {}
  const output = captureOutput()
  const result = new Promise<CommandOutcome>((done) => {
    resolve = done
  })
  const finish = (outcome: CommandOutcome) => {
    if (finished) return
    finished = true
    cancelTimer?.()
    process?.kill()
    process?.dispose()
    resolve(outcome)
  }
  if (!validCommand(input)) {
    finish({ type: 'failed', message: 'The Mac command request is invalid.' })
  } else {
    try {
      process = dependencies.launch(input.command, input.folder, {
        stdout: (bytes) => {
          if (!finished) output.write('stdout', bytes)
        },
        stderr: (bytes) => {
          if (!finished) output.write('stderr', bytes)
        },
        error: () =>
          finish({
            type: 'failed',
            message:
              'The Mac could not start the command. Check the folder and try again.',
          }),
        close: (exitCode) =>
          finish({
            type: 'result',
            result: { ...output.finish(), exitCode, timedOut: false },
          }),
      })
      cancelTimer = dependencies.clock.after(
        (input.timeoutSeconds ?? 60) * 1000,
        () =>
          finish({
            type: 'result',
            result: { ...output.finish(), exitCode: null, timedOut: true },
          }),
      )
    } catch {
      finish({
        type: 'failed',
        message:
          'The Mac could not start the command. Check the folder and try again.',
      })
    }
  }
  return { result, cancel: () => finish({ type: 'cancelled' }) }
}

export type CommandRun = ReturnType<typeof runCommand>
