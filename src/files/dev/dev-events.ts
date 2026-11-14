import type { DiffResponse } from '../../shared/generated/DiffResponse'
import type { FileEvent } from '../../shared/files'
import type { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_IDS, FAKE_TIME } from '../../test-support/fixtures/core'
import { recordedRunnerFileEvents } from '../../test-support/recorded-files'
import type { WorkspaceFiles } from '../model/files-store'
import type { FilesTab } from '../navigation'
import { splitPath } from '../navigation'
import { devTextFiles, registerDiff, registerFile } from './dev-fixtures'

/** Sends one file event as the next live event of the workspace. */
function emit(server: FakeApiServer, event: FileEvent): void {
  const eventNumber = server.events.history().throughEventNumber + 1
  server.events.emit({
    workspaceId: FAKE_IDS.workspace,
    eventNumber,
    occurredAt: FAKE_TIME + eventNumber * 1_000,
    event,
  })
}

/** Replays the recorded runner updates: a new file, a move, and a removal. */
export function playRecordedUpdates(server: FakeApiServer): void {
  for (const event of recordedRunnerFileEvents)
    emit(server, structuredClone(event))
}

/**
 * Changes the open file or diff on the fake server, then sends the events
 * that a runner sends for an edit. The change list keeps its line counts.
 */
export async function editOpenTab(
  server: FakeApiServer,
  files: WorkspaceFiles,
  tab: FilesTab,
  edit: number,
): Promise<void> {
  const line = `Edit ${edit} from the development page.`
  const base = devTextFiles.get(tab.path) ?? ''
  registerFile(server, tab.path, new TextEncoder().encode(`${base}${line}\n`))
  const old = await files.client.readDiff(tab.path)
  if (old.ok) {
    const diff: DiffResponse = {
      ...old.value,
      patch: `${old.value.patch}\n+${line}`,
    }
    registerDiff(server, diff)
  }
  const snapshot = files.getSnapshot()
  const entry = snapshot.tree?.entries.get(tab.path)
  emit(server, {
    type: 'files.changed',
    delta: {
      revision: (snapshot.tree?.revision ?? 0) + 1,
      changes: [
        {
          operation: 'upsert',
          entry: entry ?? {
            path: tab.path,
            name: splitPath(tab.path).name,
            kind: 'file',
            change: 'modified',
          },
        },
      ],
    },
  })
  if (snapshot.changes) {
    emit(server, { type: 'changes.updated', changes: snapshot.changes })
  }
}
