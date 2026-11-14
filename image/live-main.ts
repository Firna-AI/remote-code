import { access, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { LiveApp } from './live-app'
import { LiveBoat } from './live-boat'
import { CheckError, liveConfiguration, requiredInputs } from './live-input'
import { measurePlacements } from './live-measure'

async function main() {
  const root = resolve(process.cwd())
  if (process.argv.includes('--help')) {
    process.stdout.write(
      `Usage: node image/live-check.mjs [--prepare]\nRequired environment: ${requiredInputs.join(', ')}\nOptional: LIVE_AGENT_LOGIN_KIND, LIVE_RUNS, LIVE_OUTPUT, LIVE_SOFTWARE_DIR, LIVE_BOAT_API.\nThe app must already hold this account's agent login and a successful org image.\nThe script creates one app workspace and two temporary measurement sandboxes.\nIt stops the app workspace and deletes its measurement sandboxes.\nCredentials stay in memory and sandbox runtime settings.\n`,
    )
    return
  }
  await Promise.all(
    ['sdk-helper', 'measure', 'compare'].map((name) =>
      access(join(root, 'dist/sdk-helper', `${name}.mjs`)),
    ),
  )
  if (process.argv.includes('--prepare')) {
    process.stdout.write(
      `Preparation passed. SDK helper bundles and script dependencies are available.\nReal checks need: ${requiredInputs.join(', ')}.\nNo real sandbox or agent was used.\n`,
    )
    return
  }
  const config = liveConfiguration(process.env, root)
  await mkdir(config.output, { recursive: true, mode: 0o700 })
  const boat = new LiveBoat(config)
  const cleanup = new Set<string>()
  const failedCleanup: string[] = []
  let source: string | null = null
  let pendingWorkspace: string | null = null
  const report: Record<string, unknown> = {
    environment: config.boatApi.startsWith('https://boat.dev/')
      ? 'real-external-app-and-sandbox'
      : 'local-fake-endpoints',
    completed: false,
  }
  try {
    report.e2e = await new LiveApp(config).run(
      boat,
      (workspaceId, sandboxId) => {
        report.workspaceId = workspaceId
        pendingWorkspace = workspaceId
        source = sandboxId ?? null
      },
    )
    if (!source) throw new CheckError('The created workspace has no sandbox.')
    report.measurements = await measurePlacements(
      config,
      boat,
      source,
      root,
      cleanup,
    )
    report.completed = true
  } catch (error) {
    report.error =
      error instanceof CheckError
        ? error.message
        : 'An external request or response failed.'
    throw error
  } finally {
    for (const id of cleanup) {
      try {
        await boat.remove(id)
      } catch {
        failedCleanup.push(id)
      }
    }
    if (source) {
      try {
        await boat.stop(source)
      } catch {
        failedCleanup.push(source)
      }
    }
    report.cleanupNeeded = failedCleanup
    report.workspaceCleanupNeeded = source ? null : pendingWorkspace
    await writeFile(
      join(config.output, 'summary.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    )
    process.stdout.write(`Saved check results under ${config.output}.\n`)
  }
  if (failedCleanup.length)
    throw new CheckError(
      'Cloud computer cleanup failed. Read cleanupNeeded in summary.json.',
    )
}

void main().catch((error: unknown) => {
  const message =
    error instanceof CheckError
      ? error.message
      : 'Check its inputs, app admission, stored agent login, and sandbox access.'
  process.stderr.write(`The live check failed. ${message}\n`)
  process.exitCode = 1
})
