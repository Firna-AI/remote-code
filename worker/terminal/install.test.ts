import { readFile } from 'node:fs/promises'

import { expect, it } from 'vitest'

import { installationFixture } from './install.test-support'
import { terminalPackagesCommand } from './service'

it('installs terminal packages and stops and masks the package service that holds the terminal port', async () => {
  const fixture = await installationFixture()
  expect(await fixture.install()).toEqual({ code: 0, stdout: '', stderr: '' })
  expect(terminalPackagesCommand().startsWith("sudo -n -- /bin/sh -c '")).toBe(
    true,
  )
  expect(await readFile(fixture.packages, 'utf8')).toBe(
    'update\ninstall -y ttyd tmux\n',
  )
  expect(await readFile(`${fixture.units}/systemctl.log`, 'utf8')).toBe(
    'disable --now ttyd.service\nmask ttyd.service\n',
  )
})

it('ships terminal units that preserve private runtime storage and run the release scripts as the workspace user', async () => {
  const terminal = await readFile(
    'image/release/conductive-terminal.service',
    'utf8',
  )
  const sessions = await readFile(
    'image/release/conductive-terminal-sessions.service',
    'utf8',
  )
  for (const unit of [terminal, sessions]) {
    expect(unit).toContain('User=user\n')
    expect(unit).toContain('Group=user\n')
    expect(unit).toContain('WorkingDirectory=/home/user\n')
    expect(unit).toContain('RuntimeDirectory=conductive-terminal\n')
    expect(unit).toContain('RuntimeDirectoryMode=0700\n')
    expect(unit).toContain('RuntimeDirectoryPreserve=yes\n')
    expect(unit).toContain(
      'ConditionPathExists=/run/conductive-terminal/enabled\n',
    )
  }
  expect(terminal).toContain('Type=exec\n')
  expect(terminal).toContain('Requires=conductive-terminal-sessions.service\n')
  expect(terminal).toContain(
    'ExecStartPre=+/opt/conductive/current/system/terminal-password\n',
  )
  expect(terminal).toContain(
    'ExecStart=/opt/conductive/current/system/terminal\n',
  )
  expect(sessions).toContain('Type=forking\n')
  expect(sessions).toContain(
    'ExecStart=/opt/conductive/current/system/terminal-sessions\n',
  )
  const installer = await readFile('image/install-system.sh', 'utf8')
  expect(installer).toContain('systemctl daemon-reload\n')
  expect(installer).toMatch(
    /systemctl enable [^\n]*conductive-terminal\.service\n/,
  )
  expect(installer).not.toMatch(/systemctl (?:start|restart) /)
})
