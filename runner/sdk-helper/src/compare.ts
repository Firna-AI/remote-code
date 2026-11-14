import { readFile } from 'node:fs/promises'

import { number, object, oneOf, string } from './parse'

interface Sample {
  placement: 'home' | 'system'
  resumeId: string
  firstTextMs: number
  agent: string
  model: string
}

function sample(value: unknown): Sample | null {
  const input = object(value)
  if (input.environment !== 'operator-resumed-sandbox') return null
  return {
    placement: oneOf(input.placement, ['home', 'system']),
    resumeId: string(input.resumeId),
    firstTextMs: number(input.firstTextMs),
    agent: string(input.agent),
    model: string(input.model),
  }
}

function median(values: readonly number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b)
  const center = Math.floor(sorted.length / 2)
  if (!sorted.length) return null
  return sorted.length % 2
    ? sorted[center]
    : (sorted[center - 1] + sorted[center]) / 2
}

async function compare(): Promise<void> {
  const rows = (
    await Promise.all(
      process.argv.slice(2).map(async (path) => {
        const lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean)
        return lines
          .map((line) => {
            const value: unknown = JSON.parse(line)
            return sample(value)
          })
          .filter((row) => row !== null)
      }),
    )
  ).flat()
  const groups = new Map<string, Sample[]>()
  for (const row of rows) {
    const key = `${row.agent}/${row.model}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const comparisons = [...groups].map(([agentModel, rows]) => {
    const unique = new Map(
      rows.map((row) => [`${row.placement}/${row.resumeId}`, row]),
    )
    const home = [...unique.values()].filter((row) => row.placement === 'home')
    const system = [...unique.values()].filter(
      (row) => row.placement === 'system',
    )
    const homeMedianMs = median(home.map((row) => row.firstTextMs))
    const systemMedianMs = median(system.map((row) => row.firstTextMs))
    const enough = home.length >= 3 && system.length >= 3
    return {
      agentModel,
      homeRuns: home.length,
      systemRuns: system.length,
      homeMedianMs,
      systemMedianMs,
      faster:
        enough && homeMedianMs !== null && systemMedianMs !== null
          ? homeMedianMs < systemMedianMs
            ? 'home'
            : homeMedianMs > systemMedianMs
              ? 'system'
              : 'tie'
          : null,
    }
  })
  process.stdout.write(
    `${JSON.stringify({ metric: 'First text after measured process start, including warm-up', minimumDistinctResumesPerPlacement: 3, comparisons, limit: 'Operator labels identify real resumes. Local warm-only samples cannot select a location.' }, null, 2)}\n`,
  )
}

void compare().catch(() => {
  process.stderr.write('The measurement records could not be read.\n')
  process.exitCode = 1
})
