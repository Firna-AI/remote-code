//! Safe read descriptors, Git namespace replacements, and ignored context files.

#![allow(clippy::unwrap_used)]

use std::fs;
use std::os::unix::fs::symlink;
use std::process::Command;

use cnd_runner::repository::error::Error;
use cnd_runner_interface::file_tree::FileEntryKind;

use super::support::Fixture;

#[tokio::test]
async fn refuses_invalid_paths_escapes_git_aliases_and_special_files_without_blocking() {
    let h = Fixture::new().await;
    let outside = h.root.parent().unwrap().join("outside");
    fs::write(&outside, "private").unwrap();
    symlink(&outside, h.root.join("outside-link")).unwrap();
    symlink(h.root.join(".git/config"), h.root.join("git-link")).unwrap();
    for path in [
        "",
        "nul\0.txt",
        "/README.md",
        "dir//file",
        "./README.md",
        "dir/./file",
        "dir/../README.md",
        "README.md/",
        ".",
        "..",
        ".git/config",
        "dir/.git/config",
    ] {
        assert!(
            matches!(
                h.repository.read(path.into(), 100).await,
                Err(Error::Unavailable)
            ),
            "{path:?}"
        );
        assert!(
            matches!(
                h.repository.diff(path.into(), "main".into()).await,
                Err(Error::Unavailable)
            ),
            "{path:?}"
        );
    }
    for path in ["outside-link", "git-link"] {
        assert!(matches!(
            h.repository.read(path.into(), 100).await,
            Err(Error::Unavailable)
        ));
    }
    assert!(matches!(
        h.repository.read("missing".into(), 100).await,
        Err(Error::NotFound)
    ));
    assert!(matches!(
        h.repository.diff("missing".into(), "main".into()).await,
        Err(Error::NotFound)
    ));
    assert!(
        Command::new("mkfifo")
            .arg(h.root.join("pipe"))
            .status()
            .unwrap()
            .success()
    );
    symlink("pipe", h.root.join("pipe-link")).unwrap();
    assert!(matches!(
        h.repository.read("pipe".into(), 100).await,
        Err(Error::Unavailable)
    ));
    let link = h
        .repository
        .diff("pipe-link".into(), "main".into())
        .await
        .unwrap();
    assert_eq!(link.new_content.as_deref(), Some("pipe"));
    assert!(link.patch.contains("+pipe\n"));
    fs::remove_file(h.root.join("README.md")).unwrap();
    assert!(
        Command::new("mkfifo")
            .arg(h.root.join("README.md"))
            .status()
            .unwrap()
            .success()
    );
    let snapshot = h.repository.snapshot("main".into()).await.unwrap();
    assert!(
        snapshot
            .changes
            .files
            .iter()
            .any(|file| file.changed_file.path == "pipe-link")
    );
}

#[tokio::test]
async fn namespace_children_stay_absent_below_replacement_files_or_directory_links() {
    let h = Fixture::new().await;
    h.write("entry/old.txt", b"old child\n");
    h.write("target/old.txt", b"target child\n");
    h.base();
    let before = h.repository.checkpoint().await.unwrap();
    fs::remove_dir_all(h.root.join("entry")).unwrap();
    for link in [false, true] {
        if link {
            fs::remove_file(h.root.join("entry")).unwrap();
            symlink("target", h.root.join("entry")).unwrap();
        } else {
            h.write("entry", b"replacement\n");
        }
        let snapshot = h.repository.snapshot("main".into()).await.unwrap();
        assert!(
            snapshot
                .entries
                .iter()
                .any(|entry| entry.path == "entry" && entry.kind == FileEntryKind::File)
        );
        assert!(
            !snapshot
                .entries
                .iter()
                .any(|entry| entry.path.starts_with("entry/"))
        );
        let diff = h
            .repository
            .diff("entry/old.txt".into(), "main".into())
            .await
            .unwrap();
        assert_eq!(diff.old_content.as_deref(), Some("old child\n"));
        assert_eq!(diff.new_content, None);
        let checkpoint = h.repository.checkpoint().await.unwrap();
        assert!(checkpoint.contains_key("entry"));
        assert!(!checkpoint.contains_key("entry/old.txt"));
        let changed = h
            .repository
            .changed_since("main".into(), before.clone())
            .await
            .unwrap();
        assert_eq!(changed.len(), 2);
        assert_eq!(
            changed
                .iter()
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>(),
            ["entry/old.txt", "entry"]
        );
        if link {
            assert_eq!(
                h.repository
                    .read("entry/old.txt".into(), 100)
                    .await
                    .unwrap()
                    .content,
                "target child\n"
            );
        }
    }
}

#[tokio::test]
async fn file_replaced_by_directory_diffs_only_the_old_file() {
    let h = Fixture::new().await;
    h.write("entry", b"old file\n");
    h.base();
    fs::remove_file(h.root.join("entry")).unwrap();
    h.write("entry/new.txt", b"new child\n");
    for staged in [false, true] {
        if staged {
            h.git(&["add", "-A"]);
        }
        let diff = h
            .repository
            .diff("entry".into(), "main".into())
            .await
            .unwrap();
        assert_eq!(diff.old_content.as_deref(), Some("old file\n"));
        assert_eq!(diff.new_content, None);
        assert!(!diff.patch.contains("new child"));
    }
}

#[tokio::test]
async fn ignored_context_files_join_only_the_tree_and_nested_repositories_stay_whole() {
    let h = Fixture::new().await;
    h.write(".context/tracked.md", b"tracked\n");
    h.git(&["add", ".context/tracked.md"]);
    h.git(&["commit", "-m", "tracked context"]);
    h.write(".git/info/exclude", b"/.context/\nignored.tmp\n");
    h.write(".context/note.md", b"private\n");
    h.write(".context/attachments/a1/.gitignore", b"*");
    h.write(".context/attachments/a1/shot.png", b"image\n");
    h.write("nested/.context/visible.md", b"visible\n");
    h.write("ignored.tmp", b"ignored\n");
    h.git(&["init", ".context/nested"]);
    let snapshot = h.repository.snapshot("main".into()).await.unwrap();
    let paths: Vec<_> = snapshot
        .entries
        .iter()
        .map(|entry| entry.path.as_str())
        .collect();
    for path in [
        ".context/tracked.md",
        ".context/note.md",
        ".context/attachments/a1/shot.png",
        ".context/attachments",
        "nested/.context/visible.md",
        ".context/nested",
    ] {
        assert!(paths.contains(&path), "{path}");
    }
    assert!(!paths.contains(&"ignored.tmp"));
    assert_eq!(
        snapshot
            .changes
            .files
            .iter()
            .map(|file| file.changed_file.path.as_str())
            .collect::<Vec<_>>(),
        [".context/tracked.md", "nested/.context/visible.md"]
    );
}
