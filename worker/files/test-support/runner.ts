import type { RunnerFileCommand } from '../../../src/shared/generated/RunnerFileCommand'
import { MACHINE_PATHS } from '../../../src/shared/agent-tools'
import { FakeRunner } from '../../test-support/fake-runner'
import { FakeRunnerConnection } from '../../test-support/runner-connection'
import { RunnerFiles } from '../runner'
import type { WorkspaceFiles } from '../workspace'

export async function connectFilesRunner(workspaceId = 'workspace-1') {
  let sequence = 0
  const files = new RunnerFiles(() => `request-${++sequence}`)
  const runner = new FakeRunner({ workspaceId })
  const connectionId = 'connection-1'
  const connection = new FakeRunnerConnection((message) => {
    if (message.type !== 'hello' && message.type !== 'event')
      files.receive(connectionId, message)
  })
  connection.onClose(() => files.detach(connectionId))
  files.attach(connectionId, (command) => connection.reply(command))
  await runner.connect(() => connection, {
    url: `https://machines.conductive.test${MACHINE_PATHS.runner}`,
    workspaceToken: 'test-workspace-token',
  })
  return { files, runner, connection, connectionId }
}

/** The workspace owner handles authentication and numbering before these hooks. */
export async function connectWorkspaceFiles(
  files: WorkspaceFiles,
  workspaceId = 'workspace-1',
) {
  const runner = new FakeRunner({ workspaceId })
  const connectionId = 'connection-1'
  let applied: Promise<unknown> = Promise.resolve()
  const commands: RunnerFileCommand[] = []
  const waiting: ((command: RunnerFileCommand) => void)[] = []
  const connection = new FakeRunnerConnection((message) => {
    if (message.type === 'event') {
      const event = message.event
      if (
        event.type === 'files.snapshot' ||
        event.type === 'files.changed' ||
        event.type === 'files.unavailable' ||
        event.type === 'changes.updated'
      ) {
        applied = applied.then(() => files.state.apply(connectionId, event))
      }
    } else if (message.type !== 'hello') {
      files.runner.receive(connectionId, message)
    }
  })
  connection.onClose(() => files.disconnect(connectionId))
  await files.connect(connectionId, (command) => connection.reply(command))
  connection.onMessage((command) => {
    if (command.type !== 'file.read' && command.type !== 'file.diff') return
    const resolve = waiting.shift()
    if (resolve) resolve(command)
    else commands.push(command)
  })
  await runner.connect(() => connection, {
    url: `https://machines.conductive.test${MACHINE_PATHS.runner}`,
    workspaceToken: 'test-workspace-token',
  })
  return {
    runner,
    flush: () => applied,
    nextCommand: () => {
      const command = commands.shift()
      return command
        ? Promise.resolve(command)
        : new Promise<RunnerFileCommand>((resolve) => waiting.push(resolve))
    },
  }
}
