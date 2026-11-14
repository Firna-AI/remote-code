import type { CommitAuthor } from '../../src/shared/generated/CommitAuthor'
import { HttpError, isRecord } from '../http'
import { terminalPackagesCommand } from '../terminal/service'
import { privilegedCommand } from '../terminal/privileged'
import { shellQuote } from './commands'
import {
  bootstrapDownload,
  startupBootstrap,
  type StartupBootstrap,
} from './software-bootstrap'
import type { SoftwareRelease } from './software-release'
import { savedScriptCommand, type SavedScript } from './saved-script'

export interface ImageSoftwareArtifact {
  url: string
  sha256: string
}

export function readImageSoftware(value: unknown): ImageSoftwareArtifact {
  if (
    !isRecord(value) ||
    typeof value.url !== 'string' ||
    typeof value.sha256 !== 'string' ||
    !/^[a-fA-F0-9]{64}$/.test(value.sha256)
  ) {
    throw new HttpError(
      503,
      'runner_software_unavailable',
      'The cloud computer software is not available. Try again later.',
    )
  }
  let url: URL
  try {
    url = new URL(value.url)
  } catch {
    throw new HttpError(
      503,
      'runner_software_unavailable',
      'The cloud computer software is not available. Try again later.',
    )
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new HttpError(
      503,
      'runner_software_unavailable',
      'The cloud computer software is not available. Try again later.',
    )
  }
  return { url: url.href, sha256: value.sha256.toLowerCase() }
}

export function installImageSoftware(release: SoftwareRelease): string {
  return [
    'set -eu',
    terminalPackagesCommand(),
    privilegedCommand(
      [
        'set -eu',
        'umask 022',
        'apt-get install -y gh',
        bootstrapDownload(release),
        `"$conductive_bootstrap/conductive" update check --bootstrap --server ${shellQuote(release.server)}`,
        '"$conductive_bootstrap/conductive" update apply',
        'test -x /opt/conductive/current/conductive',
        'test -f /opt/conductive/current/complete',
        '/opt/conductive/current/conductive update started',
      ].join('\n'),
    ),
  ].join('\n')
}

/**
 * Git uses the owner's author outside an agent turn. The `author` and
 * `committer` keys win over a `user` setting that a script writes into a
 * repository. The runner's turn variables win over both.
 */
function ownerGitSettingsCommand(owner: CommitAuthor): string {
  return [
    '(',
    '  umask 022',
    ...['author', 'committer'].flatMap((role) => [
      `  sudo -n git config --system ${role}.name ${shellQuote(owner.name)}`,
      `  sudo -n git config --system ${role}.email ${shellQuote(owner.email)}`,
    ]),
    ')',
  ].join('\n')
}

export function workspaceStartupCommand(
  script: SavedScript,
  owner: CommitAuthor | null,
  mode: 'workspace' | 'retention' = 'workspace',
  bootstrap?: StartupBootstrap,
): string {
  const path =
    mode === 'retention'
      ? '/run/conductive/retention-startup.sh'
      : '/run/conductive/startup.sh'
  return [
    'set -eu',
    'umask 077',
    ...(owner ? [ownerGitSettingsCommand(owner)] : []),
    'sudo -n install -d -m 700 -o user -g user /run/conductive',
    savedScriptCommand(path, script, [
      'set -a',
      '. /run/ascii-secrets/env.sh',
      'set +a',
      'cd "$CONDUCTIVE_REPOSITORY_DIR"',
    ]),
    ...(mode === 'workspace'
      ? [
          ...(bootstrap ? [startupBootstrap(bootstrap)] : []),
          'touch /run/conductive/workspace-ready',
          'sudo -n flock /run/conductive/bootstrap-activate.lock systemctl restart conductive-runner.service',
        ]
      : []),
  ].join('\n')
}
