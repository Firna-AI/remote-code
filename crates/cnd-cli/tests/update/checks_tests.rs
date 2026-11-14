//! Installation locks, large downloads, and confirmation ownership.

use std::collections::HashMap;
use std::sync::Arc;

use cli_release_interface::ReleaseAssetInfo;
use cli_updater::TarGzBinaryInstaller;
use cnd_cli::update::disk::DiskStore;
use cnd_cli::update::engine::Engine;
use cnd_cli::update::http::release_client;
use cnd_cli::update::ports::{State, Store, UpdateEngine};
use cnd_cli::update::process::SystemProcesses;
use cnd_release::parts::PartsList;

use crate::support;
use crate::support::Server;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn installation_waits_for_background_check()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let root = tempfile::tempdir()?;
    let disk = Arc::new(DiskStore::new(root.path().to_path_buf()));
    let (attempt, attempted) = std::sync::mpsc::channel();
    let metadata = ReleaseAssetInfo {
        binary: "conductive".into(),
        version: "0.0.1".into(),
        target: "x86_64-unknown-linux-musl".into(),
        asset_name: "unused".into(),
        download_url: "https://releases.test/unused".into(),
        sha256: Some("a".repeat(64)),
    };
    let server = Server::start(HashMap::from([(
        "/releases/latest/conductive/x86_64-unknown-linux-musl".into(),
        serde_json::to_vec(&metadata)?,
    )]))?;
    let engine = Engine {
        store: Arc::new(support::locking::ObservedStore {
            disk: disk.clone(),
            attempt,
        }),
        client: Arc::new(server.client.clone()),
        installer: Arc::new(TarGzBinaryInstaller::new()),
        processes: Arc::new(SystemProcesses),
    };
    let task = {
        let _held = disk.lock()?.ok_or("expected download lock")?;
        let task = tokio::spawn(async move { engine.install("0.0.1").await });
        attempted.recv()?;
        assert!(disk.lock()?.is_none());
        task
    };
    let result = task.await?;
    assert!(result.is_ok(), "installation failed: {result:?}");
    server.finish()?;
    Ok(())
}

#[tokio::test]
async fn slow_large_download_survives_the_old_total_timeout()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let base = format!("http://{}", listener.local_addr()?);
    let client = release_client(&base)?;
    let asset = ReleaseAssetInfo {
        binary: "sdk-helper".into(),
        version: "0.0.3".into(),
        target: "x86_64-unknown-linux-musl".into(),
        asset_name: "helper.tar.gz".into(),
        download_url: format!("{base}/helper.tar.gz"),
        sha256: None,
    };
    let (sent, first_chunk) = tokio::sync::oneshot::channel();
    let (finish, remaining) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(support::download::large_body(listener, sent, remaining));
    let download =
        tokio::spawn(async move { cli_updater::ReleaseClient::download(&client, &asset).await });
    first_chunk.await?;
    tokio::time::pause();
    tokio::time::advance(std::time::Duration::from_secs(31)).await;
    tokio::task::yield_now().await;
    assert!(
        !download.is_finished(),
        "large body hit the old 30-second timeout"
    );
    tokio::time::resume();
    assert!(finish.send(()).is_ok());
    let bytes = download.await??;
    assert_eq!(bytes, vec![42; 1024 * 1024]);
    assert!(server.await?.is_ok());
    Ok(())
}

#[test]
fn confirmation_from_another_release_keeps_pending_fallback()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let root = tempfile::tempdir()?;
    let disk = Arc::new(DiskStore::new(root.path().to_path_buf()));
    for version in ["0.0.1", "0.0.2"] {
        disk.prepare(version)?;
        disk.complete(version, &PartsList::new(Vec::new())?)?;
    }
    let pending = State {
        current: Some("0.0.2".into()),
        previous: Some("0.0.1".into()),
        pending: Some("0.0.2".into()),
    };
    disk.transition(&pending)?;
    let engine = Engine {
        store: disk.clone(),
        client: Arc::new(release_client("http://127.0.0.1:1")?),
        installer: Arc::new(TarGzBinaryInstaller::new()),
        processes: Arc::new(SystemProcesses),
    };
    engine.started("0.0.1")?;
    assert_eq!(
        disk.state()?,
        pending,
        "another release cleared the pending start"
    );
    Ok(())
}
