import { describe, expect, test } from 'vitest'
import type { FileEntry } from '../../shared/generated/FileEntry'
import { folderLabel, mentionRows } from './mention-rows'

function entry(path: string, kind: FileEntry['kind'] = 'file'): FileEntry {
  return { path, name: path.split('/').at(-1) ?? path, kind, change: null }
}

const tree: FileEntry[] = [
  entry('src', 'directory'),
  entry('src/app', 'directory'),
  entry('src/app/api', 'directory'),
  entry('src/app/api/addresses', 'directory'),
  entry('src/app/api/addresses/route.ts'),
  entry('src/app/checkout', 'directory'),
  entry('src/app/checkout/AddressForm.tsx'),
  entry('src/app/checkout/useAddressAutocomplete.ts'),
  entry('tests', 'directory'),
  entry('tests/address.test.ts'),
  entry('.github', 'directory'),
  entry('README.md'),
]

const paths = (rows: readonly FileEntry[]) => rows.map((row) => row.path)

describe('the rows of the list of @', () => {
  test('names that start with the query come first, then names that hold it, then paths, with folders first in each group', () => {
    expect(paths(mentionRows(tree, 'ADDR'))).toEqual([
      'src/app/api/addresses',
      'tests/address.test.ts',
      'src/app/checkout/AddressForm.tsx',
      'src/app/checkout/useAddressAutocomplete.ts',
      'src/app/api/addresses/route.ts',
    ])
  })

  test('without a query, folders come first, then files, each in the order of their names', () => {
    expect(paths(mentionRows(tree, ''))).toEqual([
      '.github',
      'src/app/api/addresses',
      'src/app/api',
      'src/app',
      'src/app/checkout',
      'src',
      'tests',
      'tests/address.test.ts',
      'src/app/checkout/AddressForm.tsx',
      'README.md',
      'src/app/api/addresses/route.ts',
      'src/app/checkout/useAddressAutocomplete.ts',
    ])
  })

  test('an entry whose label hides a secret value, or whose path holds a quote, stays out', () => {
    const hidden = {
      ...entry('keys/sk-live-1/app.ts'),
      displayPath: 'keys/[redacted]/app.ts',
    }
    const quoted = entry('src/say "hi".ts')
    expect(paths(mentionRows([...tree, hidden, quoted], 'app.ts'))).toEqual([])
  })

  test('the list shows at most 100 rows, and the folder label ends with /', () => {
    const many = Array.from({ length: 105 }, (_, index) =>
      entry(`notes/note-${String(index).padStart(3, '0')}.md`),
    )
    const rows = mentionRows(many, 'note')
    expect({
      count: rows.length,
      folder: folderLabel(rows[0]),
      top: folderLabel(entry('README.md')),
    }).toEqual({ count: 100, folder: 'notes/', top: '' })
  })
})
