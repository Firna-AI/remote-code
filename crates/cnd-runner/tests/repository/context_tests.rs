//! Context setup recreates storage, preserves exclude rules, and supports linked worktrees.

#![allow(clippy::unwrap_used)]

use std::fs;
use std::os::unix::fs::symlink;

use super::support::Fixture;

#[tokio::test]
async fn prepares_context_once_recreates_removed_folders_and_uses_linked_worktree_excludes() {
    let h = Fixture::new().await;
    let exclude = h.root.join(".git/info/exclude");
    fs::write(&exclude, "existing-rule").unwrap();
    h.repository.prepare_context().await.unwrap();
    assert!(h.root.join(".context/attachments").is_dir());
    assert_eq!(
        fs::read_to_string(&exclude).unwrap(),
        "existing-rule\n/.context/\n"
    );
    h.write(".context/note.txt", b"private\n");
    let snapshot = h.repository.snapshot("main".into()).await.unwrap();
    assert!(
        snapshot
            .entries
            .iter()
            .any(|entry| entry.path == ".context/note.txt")
    );
    assert!(
        !snapshot
            .changes
            .files
            .iter()
            .any(|file| file.changed_file.path.starts_with(".context/"))
    );
    fs::remove_dir_all(h.root.join(".context")).unwrap();
    h.repository.prepare_context().await.unwrap();
    assert!(h.root.join(".context/attachments").is_dir());
    assert_eq!(
        fs::read_to_string(&exclude).unwrap(),
        "existing-rule\n/.context/\n"
    );
    let linked = h.root.parent().unwrap().join("linked");
    h.git(&["worktree", "add", "-b", "linked", linked.to_str().unwrap()]);
    let repository = Fixture::at(&linked, Default::default());
    repository.prepare_context().await.unwrap();
    assert!(linked.join(".context/attachments").is_dir());
    assert!(linked.join(".git").is_file());
    assert_eq!(
        fs::read_to_string(&exclude).unwrap(),
        "existing-rule\n/.context/\n"
    );
    fs::remove_dir_all(h.root.join(".context")).unwrap();
    fs::write(h.root.join(".context"), "occupied").unwrap();
    assert!(h.repository.prepare_context().await.is_err());
    assert_eq!(
        fs::read_to_string(h.root.join(".context")).unwrap(),
        "occupied"
    );
    fs::remove_file(h.root.join(".context")).unwrap();
    symlink(&linked, h.root.join(".context")).unwrap();
    assert!(h.repository.prepare_context().await.is_err());
    assert!(!linked.join("attachments").exists());
    fs::remove_file(&exclude).unwrap();
    fs::create_dir(&exclude).unwrap();
    assert!(h.repository.prepare_context().await.is_err());
}
