//! Tree and changes histories advance independently when a requested kind refreshes.

use std::collections::BTreeMap;

use cnd_runner_interface::file_tree::{
    FileTreeChange, FileTreeDelta, RunnerFileEvent, RunnerFileRevisionPart, RunnerFileTreePart,
};

use crate::repository::service::RepositorySnapshot;

pub(super) fn tree_update(
    previous: Option<&RepositorySnapshot>,
    current: &RepositorySnapshot,
    revision: u64,
    full: bool,
) -> Option<RunnerFileEvent> {
    let Some(previous) = previous.filter(|_| !full) else {
        return Some(RunnerFileEvent::FilesSnapshot {
            tree: RunnerFileTreePart {
                part: RunnerFileRevisionPart {
                    revision,
                    part_number: 1,
                    part_count: 1,
                },
                unavailable: None,
                entries: current.entries.clone(),
            },
        });
    };
    let before: BTreeMap<_, _> = previous
        .entries
        .iter()
        .map(|entry| (&entry.path, entry))
        .collect();
    let after: BTreeMap<_, _> = current
        .entries
        .iter()
        .map(|entry| (&entry.path, entry))
        .collect();
    let mut changes = vec![];
    for entry in &previous.entries {
        if !after.contains_key(&entry.path) {
            changes.push(FileTreeChange::Remove {
                path: entry.path.clone(),
            });
        }
    }
    for entry in &current.entries {
        if before.get(&entry.path).copied() != Some(entry)
            || previous.identities.get(&entry.path) != current.identities.get(&entry.path)
            || previous.read_identities.get(&entry.path) != current.read_identities.get(&entry.path)
        {
            changes.push(FileTreeChange::Upsert {
                entry: entry.clone(),
            });
        }
    }
    (!changes.is_empty()).then_some(RunnerFileEvent::FilesChanged {
        delta: FileTreeDelta { revision, changes },
    })
}

pub(super) fn changes_updated(
    previous: Option<&RepositorySnapshot>,
    current: &RepositorySnapshot,
) -> bool {
    previous.is_none_or(|previous| {
        previous.identities != current.identities
            || previous.base_commit != current.base_commit
            || previous.changes != current.changes
    })
}
