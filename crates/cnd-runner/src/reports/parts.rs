//! Whole entries fit conservative serialized event budgets before numbering.

use cnd_runner_interface::file_tree::{
    FILE_EVENT_MAX_BYTES, FILE_TREE_DELTA_MAX_CHANGES, RunnerFileEvent,
};
use serde::Serialize;

use crate::error::Result;
use crate::json::codec;

fn groups<T: Clone + Serialize>(
    items: &[T],
    count: usize,
    empty: impl Fn(usize) -> Result<usize>,
) -> Result<Option<Vec<Vec<T>>>> {
    let mut result = vec![vec![]];
    let mut bytes = empty(0)?;
    if bytes > FILE_EVENT_MAX_BYTES as usize {
        return Ok(None);
    }
    for item in items {
        let size = codec::encode(item)?.len();
        let last = result.len() - 1;
        if result[last].len() == count
            || bytes + size + usize::from(!result[last].is_empty()) > FILE_EVENT_MAX_BYTES as usize
        {
            result.push(vec![]);
            bytes = empty(result.len() - 1)?;
        }
        if bytes + size > FILE_EVENT_MAX_BYTES as usize {
            return Ok(None);
        }
        let last = result.len() - 1;
        bytes += size + usize::from(!result[last].is_empty());
        result[last].push(item.clone());
    }
    Ok(Some(result))
}

pub(super) fn split(event: RunnerFileEvent) -> Result<Option<Vec<RunnerFileEvent>>> {
    match event {
        RunnerFileEvent::FilesUnavailable {} => Ok(Some(vec![event])),
        RunnerFileEvent::FilesSnapshot { mut tree } => {
            let items = std::mem::take(&mut tree.entries);
            let maximum = items.len().max(1) as u64;
            tree.part.part_number = maximum;
            tree.part.part_count = maximum;
            let empty =
                codec::encode(&RunnerFileEvent::FilesSnapshot { tree: tree.clone() })?.len();
            let Some(groups) = groups(&items, usize::MAX, |_| Ok(empty))? else {
                return Ok(None);
            };
            let total = groups.len() as u64;
            Ok(Some(
                groups
                    .into_iter()
                    .enumerate()
                    .map(|(index, entries)| {
                        let mut tree = tree.clone();
                        tree.entries = entries;
                        tree.part.part_number = index as u64 + 1;
                        tree.part.part_count = total;
                        RunnerFileEvent::FilesSnapshot { tree }
                    })
                    .collect(),
            ))
        }
        RunnerFileEvent::ChangesUpdated { mut changes } => {
            let items = std::mem::take(&mut changes.changes_response.files);
            let maximum = items.len().max(1) as u64;
            changes.runner_file_revision_part.part_number = maximum;
            changes.runner_file_revision_part.part_count = maximum;
            let empty = codec::encode(&RunnerFileEvent::ChangesUpdated {
                changes: changes.clone(),
            })?
            .len();
            let Some(groups) = groups(&items, usize::MAX, |_| Ok(empty))? else {
                return Ok(None);
            };
            let total = groups.len() as u64;
            Ok(Some(
                groups
                    .into_iter()
                    .enumerate()
                    .map(|(index, files)| {
                        let mut changes = changes.clone();
                        changes.changes_response.files = files;
                        changes.runner_file_revision_part.part_number = index as u64 + 1;
                        changes.runner_file_revision_part.part_count = total;
                        RunnerFileEvent::ChangesUpdated { changes }
                    })
                    .collect(),
            ))
        }
        RunnerFileEvent::FilesChanged { mut delta } => {
            let items = std::mem::take(&mut delta.changes);
            let groups = groups(&items, FILE_TREE_DELTA_MAX_CHANGES as usize, |index| {
                let mut delta = delta.clone();
                delta.revision += index as u64;
                Ok(codec::encode(&RunnerFileEvent::FilesChanged { delta })?.len())
            })?;
            Ok(groups.map(|groups| {
                groups
                    .into_iter()
                    .enumerate()
                    .map(|(index, changes)| {
                        let mut delta = delta.clone();
                        delta.revision += index as u64;
                        delta.changes = changes;
                        RunnerFileEvent::FilesChanged { delta }
                    })
                    .collect()
            }))
        }
    }
}
