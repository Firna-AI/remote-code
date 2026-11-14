import { chmod, mkdir, writeFile } from 'node:fs/promises'

import { terminalPackagesCommand } from './service'
import { runScript, scriptFixture } from './scripts.test-support'

export async function installationFixture() {
  const fixture = await scriptFixture()
  const bin = `${fixture.root}/bin`
  const units = `${fixture.root}/units`
  const packages = `${fixture.root}/packages`
  await mkdir(bin)
  await mkdir(units)
  const programs = {
    sudo: `#!/bin/sh
[ "$1" != -n ] || shift
[ "$1" != -- ] || shift
exec "$@"
`,
    'apt-get': `#!/bin/sh
printf '%s\\n' "$*" >> '${packages}'
`,
    systemctl: `#!/bin/sh
printf '%s\\n' "$*" >> '${units}/systemctl.log'
`,
  }
  for (const [name, content] of Object.entries(programs)) {
    await writeFile(`${bin}/${name}`, content)
    await chmod(`${bin}/${name}`, 0o700)
  }
  const command = terminalPackagesCommand()
  return {
    ...fixture,
    units,
    packages,
    install: () =>
      runScript(command, false, {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
      }),
  }
}
