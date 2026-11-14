//! Reads and diffs retain exact text and binary representations and literal paths.

#![allow(clippy::unwrap_used)]

use cnd_runner_interface::file_changes::ChangeKind;
use cnd_runner_interface::files::FileResponseEncoding;

use super::support::Fixture;

#[tokio::test]
async fn reports_committed_staged_working_renamed_and_literal_untracked_files() {
    let h = Fixture::new().await;
    h.write("committed.txt", b"committed\n");
    h.git(&["add", "committed.txt"]);
    h.git(&["commit", "-m", "branch work"]);
    h.write("README.md", b"first\nstaged\n");
    h.git(&["add", "README.md"]);
    h.write("README.md", b"first\nstaged\nworking\n");
    h.git(&["mv", "rename me.txt", "renamed file.txt"]);
    h.write("new dir/file\twith\nbreak.txt", b"one\ntwo\n");
    let saved = h.stored_git();
    let snapshot = h.repository.snapshot("main".into()).await.unwrap();
    let files = &snapshot.changes.files;
    assert_eq!(
        files
            .iter()
            .map(|file| file.changed_file.path.as_str())
            .collect::<Vec<_>>(),
        [
            "committed.txt",
            "new dir/file\twith\nbreak.txt",
            "README.md",
            "renamed file.txt"
        ]
    );
    assert_eq!(snapshot.changes.unpushed_commits, Some(1));
    assert_eq!(snapshot.changes.uncommitted_file_count, Some(3));
    assert_eq!(
        (
            snapshot.changes.summary.files,
            snapshot.changes.summary.added,
            snapshot.changes.summary.removed
        ),
        (4, 5, 1)
    );
    assert_eq!(files[3].changed_file.change, ChangeKind::Renamed);
    assert_eq!(
        files[3].changed_file.previous_path.as_deref(),
        Some("rename me.txt")
    );
    assert!(!files[0].uncommitted);
    assert!(files[1..].iter().all(|file| file.uncommitted));
    let diff = h
        .repository
        .diff("README.md".into(), "main".into())
        .await
        .unwrap();
    assert_eq!(diff.old_content.as_deref(), Some("first\nsame\n"));
    assert_eq!(
        diff.new_content.as_deref(),
        Some("first\nstaged\nworking\n")
    );
    assert!(diff.patch.contains("-same\n+staged\n+working\n"));
    for path in [
        "tab\tname.txt",
        "line\nname.txt",
        "back\\slash.txt",
        "a[1].txt",
    ] {
        h.write(path, b"literal\n");
        assert_eq!(
            h.repository.read(path.into(), 100).await.unwrap().content,
            "literal\n"
        );
        assert_eq!(
            h.repository
                .diff(path.into(), "main".into())
                .await
                .unwrap()
                .new_content
                .as_deref(),
            Some("literal\n")
        );
    }
    assert_eq!(h.stored_git(), saved);
}

#[tokio::test]
async fn retains_bom_and_binary_bytes_in_reads_and_diff_versions() {
    let h = Fixture::new().await;
    h.write("bom.txt", "\u{feff}abc".as_bytes());
    h.base();
    h.write("bom.txt", "\u{feff}xyz".as_bytes());
    let read = h.repository.read("bom.txt".into(), 6).await.unwrap();
    assert_eq!(read.size_bytes, 6);
    assert_eq!(read.content, "\u{feff}xyz");
    let diff = h
        .repository
        .diff("bom.txt".into(), "main".into())
        .await
        .unwrap();
    assert_eq!(diff.old_content.as_deref(), Some("\u{feff}abc"));
    assert_eq!(diff.new_content.as_deref(), Some("\u{feff}xyz"));
    for (path, bytes, expected) in [
        ("invalid.bin", vec![0xc3, 0x28], "wyg="),
        ("nul.bin", vec![0x61, 0, 0x62], "YQBi"),
    ] {
        h.write(path, &bytes);
        let read = h.repository.read(path.into(), 3).await.unwrap();
        assert_eq!(read.encoding, FileResponseEncoding::Base64);
        assert_eq!(read.content, expected);
        let diff = h.repository.diff(path.into(), "main".into()).await.unwrap();
        assert!(diff.binary);
        assert_eq!((diff.old_content, diff.new_content), (None, None));
    }
}
