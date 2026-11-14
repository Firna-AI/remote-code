//! Serialized budgets include metadata and leave every path and summary whole.

use cnd_runner_interface::file_changes::{BranchChangedFile, ChangeKind, ChangedFile};
use cnd_runner_interface::file_tree::{FILE_EVENT_MAX_BYTES, RunnerFileEvent};
use cnd_runner_interface::runner::RunnerEvent;

use crate::json::codec;
use crate::reports::files::FileReportKind;

use super::support::{Fixture, snapshot};

#[tokio::test]
async fn splits_whole_filtered_entries_and_repeats_complete_changes_metadata() {
    let mut current = snapshot(
        (0..6)
            .map(|index| format!("{}{}", "x".repeat(90_000), index))
            .collect(),
    );
    current.changes.files = current
        .entries
        .iter()
        .map(|entry| BranchChangedFile {
            changed_file: ChangedFile {
                path: entry.path.clone(),
                display_path: None,
                previous_path: None,
                previous_display_path: None,
                change: ChangeKind::Modified,
                added: 2,
                removed: 1,
            },
            uncommitted: true,
        })
        .collect();
    current.changes.summary.files = 6;
    current.changes.summary.added = 12;
    current.changes.summary.removed = 6;
    let h = Fixture::new(current.clone());
    h.files.refresh(true, None, None).await.unwrap();
    let events = h.take();
    assert_eq!(events.len(), 6);
    let mut entries = vec![];
    let mut files = vec![];
    for (index, (event, _)) in events.iter().enumerate() {
        assert!(codec::encode(event).unwrap().len() <= FILE_EVENT_MAX_BYTES as usize);
        match event {
            RunnerEvent::RunnerFileEvent(RunnerFileEvent::FilesSnapshot { tree }) => {
                assert_eq!(
                    (
                        tree.part.revision,
                        tree.part.part_number,
                        tree.part.part_count
                    ),
                    (1, index as u64 + 1, 3)
                );
                entries.extend(tree.entries.clone());
            }
            RunnerEvent::RunnerFileEvent(RunnerFileEvent::ChangesUpdated { changes }) => {
                assert_eq!(changes.changes_response.summary, current.changes.summary);
                assert_eq!(changes.changes_response.unpushed_commits, Some(3));
                assert_eq!(changes.changes_response.uncommitted_file_count, Some(4));
                assert_eq!(
                    (
                        changes.runner_file_revision_part.revision,
                        changes.runner_file_revision_part.part_number,
                        changes.runner_file_revision_part.part_count
                    ),
                    (1, index as u64 - 2, 3)
                );
                files.extend(changes.changes_response.files.clone());
            }
            _ => panic!("expected report part"),
        }
    }
    assert_eq!(entries, current.entries);
    assert_eq!(files, current.changes.files);
    h.files
        .refresh(true, Some(FileReportKind::Tree), Some("receipt".into()))
        .await
        .unwrap();
    let requested = h.take();
    assert_eq!(requested.iter().filter(|(_, id)| id.is_some()).count(), 1);
    assert_eq!(requested.last().unwrap().1.as_deref(), Some("receipt"));
}

#[tokio::test]
async fn splits_deltas_by_count_and_bytes_and_recovers_after_an_impossible_entry() {
    let h = Fixture::new(snapshot(vec![]));
    h.files.refresh(true, None, None).await.unwrap();
    h.take();
    *h.current.lock().unwrap() = Some(snapshot(
        (0..1030).map(|index| format!("file-{index}")).collect(),
    ));
    h.files.refresh(false, None, None).await.unwrap();
    *h.current.lock().unwrap() = Some(snapshot(
        (0..6)
            .map(|index| format!("{}{index}", "\n".repeat(30_000)))
            .collect(),
    ));
    h.files.refresh(false, None, None).await.unwrap();
    let events = h.take();
    let deltas: Vec<_> = events
        .iter()
        .filter_map(|(event, _)| match event {
            RunnerEvent::RunnerFileEvent(RunnerFileEvent::FilesChanged { delta }) => Some(delta),
            _ => None,
        })
        .collect();
    assert_eq!(
        deltas
            .iter()
            .map(|delta| delta.changes.len())
            .collect::<Vec<_>>(),
        [512, 512, 6, 512, 512, 10, 2]
    );
    assert_eq!(
        deltas
            .iter()
            .map(|delta| delta.revision)
            .collect::<Vec<_>>(),
        [2, 3, 4, 5, 6, 7, 8]
    );
    for (event, _) in events {
        assert!(codec::encode(&event).unwrap().len() <= 262144);
    }
    *h.current.lock().unwrap() = Some(snapshot(vec!["\n".repeat(140_000)]));
    h.files.refresh(true, None, None).await.unwrap();
    assert!(h.take().is_empty());
    *h.current.lock().unwrap() = Some(snapshot(vec![]));
    h.files.refresh(true, None, None).await.unwrap();
    assert!(
        matches!(&h.take()[0].0, RunnerEvent::RunnerFileEvent(RunnerFileEvent::FilesSnapshot { tree }) if tree.part.revision == 9)
    );
}
