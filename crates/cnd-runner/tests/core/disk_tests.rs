//! Production filesystem boundary and restart compatibility.

use std::sync::Arc;

use cnd_runner::disk::{AtomicDisk, Disk};
use cnd_runner::error::Error;
use cnd_runner::socket::{Connector, WebSocketConnector};
use cnd_runner::state::records::RunnerState;
use tempfile::tempdir;

use crate::support::events::title;
use crate::support::fixture;
use crate::support::workspace::request;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

#[tokio::test]
async fn atomically_saves_private_node_format_and_reads_it_after_restart() {
    let directory = tempdir().unwrap();
    let folder = directory.path().join("private");
    let path = folder.join("state.json");
    let disk: Arc<dyn Disk> = Arc::new(AtomicDisk::new(path.clone()));
    assert_eq!(disk.read().await.unwrap(), None);
    let store = fixture::open(disk.clone()).await;
    store
        .append(title("é😀\n"), 100, Some("receipt".into()))
        .await
        .unwrap();
    let raw = disk.read().await.unwrap().unwrap();
    let saved = RunnerState::decode(&raw).unwrap();
    assert_eq!(saved, store.snapshot().await);
    assert_eq!(fixture::open(disk.clone()).await.snapshot().await, saved);
    #[cfg(unix)]
    {
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            std::fs::metadata(&folder).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }
    std::fs::write(&path, b"broken state").unwrap();
    let bad = disk.read().await.unwrap().unwrap();
    assert!(matches!(RunnerState::decode(&bad), Err(Error::Internal(_))));
    let unreadable: Arc<dyn Disk> = Arc::new(AtomicDisk::new(folder));
    assert!(matches!(unreadable.read().await, Err(Error::Internal(_))));
}

#[tokio::test]
async fn refuses_plaintext_endpoints_before_using_the_bearer_token() {
    for scheme in ["http", "ws", "file"] {
        let mut input = request();
        input.url = format!("{scheme}://machine.test/v1/runner");
        assert!(matches!(
            WebSocketConnector.connect(&input).await,
            Err(Error::TlsRequired)
        ));
    }
}
