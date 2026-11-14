//! Git identities preserve filters, modes, link text, rename ownership, and submodules.

#![allow(clippy::unwrap_used)]

use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};

use cnd_runner_interface::file_changes::ChangeKind;

use super::support::Fixture;

#[tokio::test]
async fn checkpoints_keep_git_representations_and_scans_track_readable_raw_changes() {
    let h = Fixture::new().await;
    h.write("target.txt", b"same\n");
    h.write("other.txt", b"same\n");
    h.write("ignored-target.txt", b"ignored first\n");
    h.write(".gitignore", b"ignored-target.txt\n");
    symlink("ignored-target.txt", h.root.join("ignored-link")).unwrap();
    symlink("target.txt", h.root.join("link")).unwrap();
    h.write(".gitattributes", b"filtered.txt filter=upper\n");
    h.git(&["config", "filter.upper.clean", "tr a-z A-Z"]);
    h.git(&["config", "filter.upper.smudge", "cat"]);
    h.write("filtered.txt", b"first\n");
    h.base();
    let stored = h.stored_git();
    let first = h.repository.checkpoint().await.unwrap();
    let before = h.repository.snapshot("main".into()).await.unwrap();
    h.write("ignored-target.txt", b"ignored second\n");
    let after = h.repository.snapshot("main".into()).await.unwrap();
    assert_eq!(before.identities, after.identities);
    assert_ne!(
        before.read_identities["ignored-link"],
        after.read_identities["ignored-link"]
    );
    assert_eq!(
        h.repository
            .read("ignored-link".into(), 100)
            .await
            .unwrap()
            .content,
        "ignored second\n"
    );
    h.write("target.txt", b"changed target\n");
    assert_eq!(
        h.repository
            .changed_since("main".into(), first)
            .await
            .unwrap()
            .iter()
            .map(|file| file.path.as_str())
            .collect::<Vec<_>>(),
        ["target.txt"]
    );
    fs::remove_file(h.root.join("link")).unwrap();
    symlink("other.txt", h.root.join("link")).unwrap();
    let diff = h
        .repository
        .diff("link".into(), "main".into())
        .await
        .unwrap();
    assert_eq!(diff.old_content.as_deref(), Some("target.txt"));
    assert_eq!(diff.new_content.as_deref(), Some("other.txt"));
    assert_eq!(
        h.repository.read("link".into(), 100).await.unwrap().content,
        "same\n"
    );
    let before = h.repository.checkpoint().await.unwrap();
    fs::set_permissions(h.root.join("README.md"), fs::Permissions::from_mode(0o755)).unwrap();
    let changes = h
        .repository
        .changed_since("main".into(), before)
        .await
        .unwrap();
    assert_eq!(changes.len(), 1);
    assert_eq!(
        (
            changes[0].path.as_str(),
            changes[0].added,
            changes[0].removed
        ),
        ("README.md", 0, 0)
    );
    h.git(&["config", "core.fileMode", "false"]);
    let before = h.repository.checkpoint().await.unwrap();
    fs::set_permissions(h.root.join("README.md"), fs::Permissions::from_mode(0o644)).unwrap();
    assert!(
        h.repository
            .changed_since("main".into(), before)
            .await
            .unwrap()
            .is_empty()
    );
    h.write("filtered.txt", b"second\n");
    let diff = h
        .repository
        .diff("filtered.txt".into(), "main".into())
        .await
        .unwrap();
    assert_eq!(
        (diff.old_content.as_deref(), diff.new_content.as_deref()),
        (Some("FIRST\n"), Some("SECOND\n"))
    );
    let before = h.repository.snapshot("main".into()).await.unwrap();
    h.write("filtered.txt", b"SECOND\n");
    let after = h.repository.snapshot("main".into()).await.unwrap();
    assert_eq!(before.identities, after.identities);
    assert_ne!(
        before.read_identities["filtered.txt"],
        after.read_identities["filtered.txt"]
    );
    assert_eq!(h.stored_git(), stored);
}

#[tokio::test]
async fn rename_appears_once_even_when_only_its_old_path_changed_during_the_turn() {
    for method in ["staged", "plain", "old-path-only"] {
        let h = Fixture::new().await;
        if method == "old-path-only" {
            h.write("renamed.txt", b"keep\nthese\nlines\n");
        }
        let before = h.repository.checkpoint().await.unwrap();
        match method {
            "staged" => {
                h.git(&["mv", "rename me.txt", "renamed.txt"]);
            }
            "plain" => {
                fs::rename(h.root.join("rename me.txt"), h.root.join("renamed.txt")).unwrap()
            }
            _ => fs::remove_file(h.root.join("rename me.txt")).unwrap(),
        }
        let changed = h
            .repository
            .changed_since("main".into(), before)
            .await
            .unwrap();
        assert_eq!(changed.len(), 1);
        assert_eq!(changed[0].path, "renamed.txt");
        assert_eq!(changed[0].previous_path.as_deref(), Some("rename me.txt"));
        assert_eq!(changed[0].change, ChangeKind::Renamed);
        assert_eq!((changed[0].added, changed[0].removed), (0, 0));
    }
}

#[tokio::test]
async fn submodule_commit_and_worktree_changes_leave_both_indexes_and_objects_unchanged() {
    let h = Fixture::new().await;
    let child = Fixture::new().await;
    let original = child.git(&["rev-parse", "HEAD"]).trim().to_owned();
    child.write("README.md", b"child commit\n");
    child.git(&["add", "."]);
    child.git(&["commit", "-m", "child work"]);
    let recorded = child.git(&["rev-parse", "HEAD"]).trim().to_owned();
    h.git(&[
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        child.root.to_str().unwrap(),
        "module",
    ]);
    h.base();
    let saved = h.stored_git();
    let before = h.repository.checkpoint().await.unwrap();
    h.git(&["-C", "module", "checkout", &original]);
    let changes = h
        .repository
        .changed_since("main".into(), before)
        .await
        .unwrap();
    assert_eq!(
        changes
            .iter()
            .map(|file| file.path.as_str())
            .collect::<Vec<_>>(),
        ["module"]
    );
    let diff = h
        .repository
        .diff("module".into(), "main".into())
        .await
        .unwrap();
    assert_eq!(
        diff.old_content,
        Some(format!("Subproject commit {recorded}\n"))
    );
    assert_eq!(
        diff.new_content,
        Some(format!("Subproject commit {original}\n"))
    );
    let before = h.repository.checkpoint().await.unwrap();
    let module_index_path = h
        .git(&[
            "-C",
            "module",
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            "index",
        ])
        .trim()
        .to_owned();
    let module_index = fs::read(&module_index_path).unwrap();
    h.write("module/README.md", b"child worktree\n");
    assert_eq!(
        h.repository
            .changed_since("main".into(), before)
            .await
            .unwrap()[0]
            .path,
        "module"
    );
    assert_eq!(
        h.repository
            .diff("module".into(), "main".into())
            .await
            .unwrap()
            .new_content,
        Some(format!("Subproject commit {original}-dirty\n"))
    );
    assert_eq!(h.stored_git(), saved);
    assert_eq!(fs::read(module_index_path).unwrap(), module_index);
}
