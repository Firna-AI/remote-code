import type { FileEntry } from '../../shared/generated/FileEntry'
import { canMention } from '../../shared/mention-text'

/** The most rows that the list shows. A longer query narrows it. */
const MENTION_ROW_LIMIT = 100

/** The label of the whole path of an entry: the real path when it hides nothing. */
function pathLabel(entry: FileEntry): string {
  return entry.displayPath ?? entry.path
}

/**
 * Whether the list offers an entry. An entry whose label hides a secret
 * value stays out, because the message would hold its real path, and so
 * does a path that no mention can hold.
 */
export function mentionable(entry: FileEntry): boolean {
  return pathLabel(entry) === entry.path && canMention(entry.path)
}

/** The label of the folder that holds an entry, with a final `/`, or ''. */
export function folderLabel(entry: FileEntry): string {
  const path = pathLabel(entry)
  const end = path.lastIndexOf('/')
  return end < 0 ? '' : path.slice(0, end + 1)
}

/** An entry with the lower-case texts that a query reads, and its rank. */
interface Ranked {
  entry: FileEntry
  name: string
  path: string
  rank: number
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function byRank(a: Ranked, b: Ranked): number {
  return (
    a.rank - b.rank ||
    Number(a.entry.kind === 'file') - Number(b.entry.kind === 'file') ||
    compare(a.name, b.name) ||
    compare(a.path, b.path)
  )
}

/**
 * How well an entry matches a lower-case query: 0 when its name starts with
 * the query, 1 when its name holds it, 2 when its path holds it, and null
 * when it does not match. An empty query matches each entry in rank 0.
 */
function rankOf(name: string, path: string, query: string): number | null {
  if (name.startsWith(query)) return 0
  if (name.includes(query)) return 1
  if (path.includes(query)) return 2
  return null
}

/**
 * The rows of the list of `@` for a query: the entries that match, the best
 * first. In each rank, folders come before files, each in the order of
 * their names. Case does not count. At most `MENTION_ROW_LIMIT` rows show.
 */
export function mentionRows(
  entries: Iterable<FileEntry>,
  query: string,
): FileEntry[] {
  const wanted = query.toLowerCase()
  const found: Ranked[] = []
  for (const entry of entries) {
    if (!mentionable(entry)) continue
    const name = entry.name.toLowerCase()
    const path = entry.path.toLowerCase()
    const rank = rankOf(name, path, wanted)
    if (rank !== null) found.push({ entry, name, path, rank })
  }
  return found
    .sort(byRank)
    .slice(0, MENTION_ROW_LIMIT)
    .map((row) => row.entry)
}
