//! Base selection reads refs and settings without moving branches or fetching.

#![allow(clippy::unwrap_used)]

use std::fs;
use std::process::Command;

use super::support::Fixture;

#[tokio::test]
async fn remote_base_and_current_branch_setting_win_and_invalid_selected_base_fails() {
    let h = Fixture::new().await;
    h.git(&["branch", "review-source"]);
    h.write("README.md", b"first\nremote base work\n");
    h.write("base-only.txt", b"remote base file\n");
    h.git(&["add", "."]);
    h.git(&["commit", "-m", "remote base"]);
    h.git(&["update-ref", "refs/remotes/origin/review-source", "HEAD"]);
    h.write("README.md", b"first\nremote base work\nrun work\n");
    h.git(&["add", "README.md"]);
    h.git(&["commit", "-m", "task work"]);
    let head = h.git(&["rev-parse", "HEAD"]);
    h.git(&[
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
        "refs/remotes/origin/main",
    ]);
    h.git(&["config", "branch.task.gh-merge-base", "review-source"]);
    let snapshot = h.repository.snapshot("main".into()).await.unwrap();
    assert_eq!(snapshot.changes.base_branch, "review-source");
    assert_eq!(snapshot.changes.unpushed_commits, Some(1));
    assert_eq!(
        (
            snapshot.changes.summary.files,
            snapshot.changes.summary.added,
            snapshot.changes.summary.removed
        ),
        (1, 1, 0)
    );
    assert!(
        snapshot
            .entries
            .iter()
            .any(|entry| entry.path == "base-only.txt" && entry.change.is_none())
    );
    let diff = h
        .repository
        .diff("README.md".into(), "main".into())
        .await
        .unwrap();
    assert_eq!(diff.base_branch, "review-source");
    assert_eq!(
        diff.old_content.as_deref(),
        Some("first\nremote base work\n")
    );
    assert_eq!(h.git(&["rev-parse", "HEAD"]), head);
    h.git(&["config", "branch.task.gh-merge-base", "missing"]);
    assert!(h.repository.snapshot("main".into()).await.is_err());
    assert!(
        h.repository
            .diff("README.md".into(), "main".into())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn advancing_base_without_merge_keeps_comparison_but_merging_updates_base_identity() {
    let h = Fixture::new().await;
    h.write("README.md", b"first\ntask\n");
    h.git(&["add", "README.md"]);
    h.git(&["commit", "-m", "task work"]);
    let before = h.repository.snapshot("main".into()).await.unwrap();
    h.git(&["checkout", "main"]);
    h.write("README.md", b"first\nmain\n");
    h.write("base-only.txt", b"new base\n");
    h.git(&["add", "."]);
    h.git(&["commit", "-m", "main work"]);
    h.git(&["update-ref", "refs/remotes/origin/main", "HEAD"]);
    h.git(&["checkout", "task"]);
    let fetched = h.repository.snapshot("main".into()).await.unwrap();
    assert_eq!(before, fetched);
    assert!(
        !fetched
            .entries
            .iter()
            .any(|entry| entry.path == "base-only.txt")
    );
    h.git(&["merge", "--strategy=ours", "--no-edit", "main"]);
    let merged = h.repository.snapshot("main".into()).await.unwrap();
    assert_ne!(merged.base_commit, before.base_commit);
    assert_eq!(merged.changes.unpushed_commits, Some(2));
    assert_eq!(
        h.repository
            .diff("README.md".into(), "main".into())
            .await
            .unwrap()
            .old_content
            .as_deref(),
        Some("first\nmain\n")
    );
}

#[tokio::test]
async fn raw_status_and_unpushed_counts_change_when_the_base_relative_list_is_empty() {
    let h = Fixture::new().await;
    h.write("README.md", b"pushed branch\n");
    h.git(&["add", "README.md"]);
    h.git(&["commit", "-m", "branch work"]);
    h.git(&["update-ref", "refs/remotes/backup/task", "HEAD"]);
    h.write("README.md", b"first\nsame\n");
    let dirty = h.repository.changes("main".into()).await.unwrap();
    assert!(dirty.files.is_empty());
    assert_eq!(
        (dirty.uncommitted_file_count, dirty.unpushed_commits),
        (Some(1), Some(0))
    );
    h.git(&["add", "README.md"]);
    h.git(&["commit", "-m", "restore base"]);
    let local = h.repository.changes("main".into()).await.unwrap();
    assert!(local.files.is_empty());
    assert_eq!(
        (local.uncommitted_file_count, local.unpushed_commits),
        (Some(0), Some(1))
    );
    h.git(&["update-ref", "refs/remotes/origin/task", "HEAD"]);
    assert_eq!(
        h.repository
            .changes("main".into())
            .await
            .unwrap()
            .unpushed_commits,
        Some(0)
    );
    h.git(&["update-ref", "-d", "refs/remotes/origin/main"]);
    h.git(&["update-ref", "-d", "refs/remotes/origin/task"]);
    h.git(&["update-ref", "-d", "refs/remotes/backup/task"]);
    assert_eq!(
        h.repository
            .changes("main".into())
            .await
            .unwrap()
            .unpushed_commits,
        Some(3)
    );
}

#[tokio::test]
async fn an_unborn_repository_has_no_comparison_base() {
    let directory = tempfile::tempdir().unwrap();
    fs::create_dir(directory.path().join("repo")).unwrap();
    let root = directory.path().join("repo");
    assert!(
        Command::new("git")
            .args(["init", "--initial-branch=main"])
            .arg(&root)
            .output()
            .unwrap()
            .status
            .success()
    );
    let repository = Fixture::at(&root, Default::default());
    assert!(repository.snapshot("main".into()).await.is_err());
}
