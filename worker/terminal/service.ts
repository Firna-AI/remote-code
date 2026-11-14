import type { AppEnv } from '../env'
import { workspaceTarget } from '../previews/access'
import { WorkspaceTools } from '../previews/provider'
import type { ToolDependencies } from '../previews/types'
import { ProviderError } from '../sandbox/errors'
import type { SandboxProvider } from '../sandbox/provider'
import { cacheTerminalPassword } from './credentials'
import { privilegedCommand, shellArgument } from './privileged'
import {
  TERMINAL_RUNTIME,
  TERMINAL_RUNTIME_VIEW,
  TERMINAL_RESTORE_MARKER,
} from './scripts'

export function terminalPackagesCommand(): string {
  return privilegedCommand(`set -eu
apt-get update
apt-get install -y ttyd tmux
# The ttyd package enables its own service on port 7681, which the
# workspace terminal needs. Stop it and keep it from starting.
systemctl disable --now ttyd.service 2>/dev/null || true
systemctl mask ttyd.service`)
}

/** The lifecycle launches this command detached after the startup script exits. */
export function terminalStartCommand(): string {
  return privilegedCommand(`set -eu
install -d -m 700 -o user -g user /run/conductive-terminal
touch /run/conductive-terminal/enabled
systemctl stop ttyd.service 2>/dev/null || true
systemctl start conductive-terminal.service
systemctl is-active --quiet conductive-terminal.service
install -d -m 700 -o user -g user ${TERMINAL_RUNTIME_VIEW}
mountpoint -q ${TERMINAL_RUNTIME_VIEW} || mount --bind ${TERMINAL_RUNTIME} ${TERMINAL_RUNTIME_VIEW}`)
}

export async function markTerminalRestoreEnded(
  provider: Pick<SandboxProvider, 'runCommand'>,
  sandboxId: string,
): Promise<void> {
  const result = await provider.runCommand(
    sandboxId,
    privilegedCommand(`touch ${shellArgument(TERMINAL_RESTORE_MARKER)}`),
  )
  if (result.exitCode !== 0 || result.timedOut)
    throw new ProviderError('unavailable', 502)
}

/** Read and cache the password only after the detached setup command succeeds. */
export async function startWorkspaceTerminal(
  env: AppEnv,
  orgId: string,
  workspaceId: string,
  dependencies: ToolDependencies,
): Promise<void> {
  const target = await workspaceTarget(env, orgId, workspaceId)
  const provider = await WorkspaceTools.forWorkspace(
    env,
    target,
    dependencies.fetch,
  )
  const file = await provider.readFile(`${TERMINAL_RUNTIME_VIEW}/password`, 64)
  if (file.kind !== 'file') throw new ProviderError('invalid_response', 502)
  let password: string
  try {
    password =
      file.file.encoding === 'base64'
        ? atob(file.file.content)
        : file.file.content
  } catch {
    throw new ProviderError('invalid_response', 502)
  }
  if (file.file.sizeBytes !== 64 || !/^[a-f0-9]{64}$/.test(password))
    throw new ProviderError('invalid_response', 502)
  await cacheTerminalPassword(env, target, password, dependencies.now())
}
