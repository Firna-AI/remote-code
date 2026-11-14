//! File versions, caller caps, patch bytes, and active child cancellation.

#![allow(clippy::unwrap_used)]

use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::process::Command;
use std::sync::Arc;

use cnd_runner::repository::error::Error;
use cnd_runner::repository::git::{Cancellation, ChildGit, GitRequest, GitRunner};
use cnd_runner_interface::files::FILE_READ_MAX_BYTES;

use super::support::Fixture;

#[tokio::test]
async fn enforces_each_version_and_patch_limit_and_clamps_a_larger_read_request() {
    let h = Fixture::new().await;
    h.write("README.md", &vec![0; FILE_READ_MAX_BYTES as usize]);
    assert!(
        h.repository
            .diff("README.md".into(), "main".into())
            .await
            .unwrap()
            .binary
    );
    h.base();
    h.write("README.md", b"small current\n");
    assert!(
        h.repository
            .diff("README.md".into(), "main".into())
            .await
            .unwrap()
            .binary
    );
    h.write("README.md", &vec![0; FILE_READ_MAX_BYTES as usize]);
    let file = OpenOptions::new()
        .write(true)
        .open(h.root.join("README.md"))
        .unwrap();
    file.set_len(FILE_READ_MAX_BYTES + 1).unwrap();
    assert!(matches!(
        h.repository.diff("README.md".into(), "main".into()).await,
        Err(Error::TooLarge {
            size: 5_242_881,
            limit: 5_242_880
        })
    ));
    assert!(matches!(
        h.repository
            .read("README.md".into(), FILE_READ_MAX_BYTES * 2)
            .await,
        Err(Error::TooLarge {
            size: 5_242_881,
            limit: 5_242_880
        })
    ));
    h.base();
    h.write("README.md", b"small current\n");
    assert!(matches!(
        h.repository.diff("README.md".into(), "main".into()).await,
        Err(Error::TooLarge {
            size: 5_242_881,
            limit: 5_242_880
        })
    ));
    h.write("README.md", &vec![b'a'; 2_700_000]);
    h.base();
    h.write("README.md", &vec![b'b'; 2_700_000]);
    assert!(matches!(
        h.repository.diff("README.md".into(), "main".into()).await,
        Err(Error::TooLarge {
            size: 5_242_881,
            limit: 5_242_880
        })
    ));
}

#[tokio::test]
async fn cancellation_stops_future_commands_and_a_child_already_reading_a_pipe() {
    let h = Fixture::new().await;
    let canceled = Cancellation::default();
    canceled.cancel();
    let repository = Fixture::at(&h.root, canceled);
    assert!(matches!(
        repository.snapshot("main".into()).await,
        Err(Error::Canceled)
    ));
    let path = h.root.join("held-input");
    assert!(
        Command::new("mkfifo")
            .arg(&path)
            .status()
            .unwrap()
            .success()
    );
    let cancellation = Cancellation::default();
    let runner: Arc<dyn GitRunner> = Arc::new(ChildGit);
    let request = GitRequest {
        root: h.root.clone(),
        args: vec!["hash-object".into(), "held-input".into()],
        environment: BTreeMap::new(),
        input: vec![],
        literal_paths: true,
        max_bytes: None,
        cancellation: cancellation.clone(),
    };
    let running = tokio::spawn(async move { runner.run(request).await });
    let writer =
        tokio::task::spawn_blocking(move || OpenOptions::new().write(true).open(path).unwrap())
            .await
            .unwrap();
    cancellation.cancel();
    assert!(matches!(running.await.unwrap(), Err(Error::Canceled)));
    let _writer: File = writer;
    assert!(h.git(&["--version"]).starts_with("git version "));
}
