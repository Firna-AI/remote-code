import { expect, it } from 'vitest'

import { readSavedScript } from './saved-script'
import { SOFTWARE_RELEASE as SOFTWARE } from './software-release-test-support'
import { installImageSoftware, workspaceStartupCommand } from './image-software'

function unquote(command: string): string {
  return command.replaceAll("'\"'\"'", "'")
}

it('installs verified release software and apt packages without the legacy installers', () => {
  const command = unquote(installImageSoftware(SOFTWARE))
  expect(command).toContain('set -eu\numask 022')
  expect(command).toContain('apt-get install -y gh')
  expect(command).toContain('apt-get install -y ttyd tmux')
  expect(command).toContain('systemctl mask ttyd.service')
  expect(command.indexOf('systemctl mask ttyd.service')).toBeLessThan(
    command.indexOf('update apply'),
  )
  expect(command).toContain('sha256sum --check --status')
  expect(command.indexOf('sha256sum')).toBeLessThan(command.indexOf('tar -xzf'))
  expect(command).toContain(
    'tar -xzf "$conductive_bootstrap/program.tar.gz" -C "$conductive_bootstrap" conductive',
  )
  expect(command).toContain('update check --bootstrap --server')
  expect(command.indexOf('update check')).toBeLessThan(
    command.indexOf('update apply'),
  )
  expect(command.indexOf('update apply')).toBeLessThan(
    command.indexOf('test -x /opt/conductive/current/conductive'),
  )
  expect(command).toContain('test -f /opt/conductive/current/complete')
  expect(command.indexOf('current/complete')).toBeLessThan(
    command.indexOf('update started'),
  )
  expect(command).not.toContain('install.sh')
  expect(command).not.toContain('install-runtime.sh')
  expect(command).not.toContain('/etc/systemd/system/conductive-terminal')
  expect(command).not.toContain('systemctl restart')
})

it('bootstraps only a missing program in a detached root job and serializes activation with runner restart', () => {
  const command = unquote(
    workspaceStartupCommand(readSavedScript(''), null, 'workspace', {
      release: SOFTWARE,
    }),
  )
  expect(command).toContain(
    'if [ ! -x /opt/conductive/current/conductive ]; then',
  )
  expect(command).toContain('sudo -n -- /bin/sh -c')
  expect(command).toContain('set -eu\numask 022')
  expect(command).toContain('nohup setsid sh -c')
  expect(command).toContain('</dev/null >/run/conductive/bootstrap.log 2>&1 &')
  expect(command).toContain('flock -n 9 || exit 0')
  expect(command).toContain('update check --bootstrap --server')
  expect(command).toContain(
    'flock /run/conductive/bootstrap-activate.lock sh -c',
  )
  expect(command).toContain('update started')
  expect(command).toContain(
    'sudo -n flock /run/conductive/bootstrap-activate.lock systemctl restart conductive-runner.service',
  )
  expect(command.indexOf('update check')).toBeLessThan(
    command.indexOf('flock /run/conductive/bootstrap-activate.lock sh -c'),
  )
  expect(command).not.toContain('apt-get')
  expect(command).not.toContain('systemctl start')
  const retention = workspaceStartupCommand(
    readSavedScript(''),
    null,
    'retention',
    {
      release: SOFTWARE,
    },
  )
  expect(retention).not.toContain('nohup')
  expect(retention).not.toContain('systemctl restart')
})

it('warns and still restarts the runner when release discovery failed', () => {
  const command = workspaceStartupCommand(
    readSavedScript(''),
    null,
    'workspace',
    {
      warning: 'Warning: release unavailable',
    },
  )
  expect(command).toContain("printf '%s\\n' 'Warning: release unavailable' >&2")
  expect(command).not.toContain('nohup')
  expect(command).toContain('systemctl restart conductive-runner.service')
})
