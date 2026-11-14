//! Independent report histories, content-only edits, and full recovery after failure.

use cnd_runner_interface::file_tree::RunnerFileEvent;
use cnd_runner_interface::runner::RunnerEvent;

use crate::reports::files::FileReportKind;

use super::support::{Fixture, snapshot};

fn kinds(events: &[(RunnerEvent, Option<String>)]) -> Vec<&'static str> {
    events
        .iter()
        .map(|(event, _)| match event {
            RunnerEvent::RunnerFileEvent(RunnerFileEvent::FilesSnapshot { .. }) => "tree",
            RunnerEvent::RunnerFileEvent(RunnerFileEvent::FilesChanged { .. }) => "delta",
            RunnerEvent::RunnerFileEvent(RunnerFileEvent::ChangesUpdated { .. }) => "changes",
            RunnerEvent::RunnerFileEvent(RunnerFileEvent::FilesUnavailable {}) => "unavailable",
            _ => "other",
        })
        .collect()
}

#[tokio::test]
async fn requested_kind_preserves_other_history_and_failed_scans_require_full_recovery() {
    let h = Fixture::new(snapshot(vec![]));
    h.files.refresh(true, None, None).await.unwrap();
    assert_eq!(kinds(&h.take()), ["tree", "changes"]);
    let mut first = snapshot(vec!["first".into()]);
    first.changes.unpushed_commits = Some(7);
    *h.current.lock().unwrap() = Some(first);
    h.files
        .refresh(true, Some(FileReportKind::Tree), None)
        .await
        .unwrap();
    assert_eq!(kinds(&h.take()), ["tree"]);
    h.files.refresh(false, None, None).await.unwrap();
    assert_eq!(kinds(&h.take()), ["changes"]);
    let mut current = snapshot(vec!["second".into()]);
    current.changes.uncommitted_file_count = Some(7);
    *h.current.lock().unwrap() = Some(current);
    h.files
        .refresh(true, Some(FileReportKind::Changes), None)
        .await
        .unwrap();
    assert_eq!(kinds(&h.take()), ["changes"]);
    h.files.refresh(false, None, None).await.unwrap();
    assert_eq!(kinds(&h.take()), ["delta"]);
    *h.current.lock().unwrap() = None;
    h.files
        .refresh(true, Some(FileReportKind::Changes), Some("failed".into()))
        .await
        .unwrap();
    let unavailable = h.take();
    assert_eq!(kinds(&unavailable), ["unavailable"]);
    assert_eq!(unavailable[0].1.as_deref(), Some("failed"));
    *h.current.lock().unwrap() = Some(snapshot(vec!["second".into()]));
    h.files.refresh(false, None, None).await.unwrap();
    assert_eq!(kinds(&h.take()), ["tree", "changes"]);
}

#[tokio::test]
async fn raw_read_identity_changes_only_tree_and_git_or_base_changes_refresh_changes() {
    let mut current = snapshot(vec!["file".into()]);
    current.identities.insert("file".into(), "git-a".into());
    current
        .read_identities
        .insert("file".into(), "raw-a".into());
    let h = Fixture::new(current.clone());
    h.files.refresh(true, None, None).await.unwrap();
    h.take();
    current
        .read_identities
        .insert("file".into(), "raw-b".into());
    *h.current.lock().unwrap() = Some(current.clone());
    h.files.refresh(false, None, None).await.unwrap();
    assert_eq!(kinds(&h.take()), ["delta"]);
    current.identities.insert("file".into(), "git-b".into());
    *h.current.lock().unwrap() = Some(current.clone());
    h.files.refresh(false, None, None).await.unwrap();
    assert_eq!(kinds(&h.take()), ["delta", "changes"]);
    current.base_commit = "new-base".into();
    *h.current.lock().unwrap() = Some(current.clone());
    h.files.refresh(false, None, None).await.unwrap();
    assert_eq!(kinds(&h.take()), ["changes"]);
    current.changes.unpushed_commits = Some(8);
    *h.current.lock().unwrap() = Some(current);
    h.files.refresh(false, None, None).await.unwrap();
    assert_eq!(kinds(&h.take()), ["changes"]);
}
