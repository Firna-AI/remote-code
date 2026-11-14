//! Check and apply against real files, subprocesses, archives, and local HTTP.

use std::collections::HashMap;
use std::fs;
use std::sync::Arc;

use cli_release_interface::ReleaseAssetInfo;
use cli_updater::TarGzBinaryInstaller;
use cnd_cli::update::disk::DiskStore;
use cnd_cli::update::engine::Engine;
use cnd_cli::update::ports::{State, Store, UpdateEngine};
use cnd_cli::update::process::SystemProcesses;
use cnd_release::files::sha256;
use cnd_release::parts::{Part, PartsList};

use crate::support::{Server, archive};

#[tokio::test]
async fn check_then_apply_preserves_running_files_and_supports_fallback()
-> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let root = tempfile::tempdir()?;
    let mut responses = HashMap::new();
    let mut parts = Vec::new();
    for (name, file, bytes) in [
        ("sdk-helper", "sdk-helper.mjs", b"helper bytes".to_vec()),
        (
            "node",
            "node-v24-linux-x64/bin/node",
            b"node bytes".to_vec(),
        ),
        (
            "system",
            "install-system.sh",
            format!(
                "#!/bin/sh\ntouch '{}'\n",
                root.path().join("installed").display()
            )
            .into_bytes(),
        ),
    ] {
        let bytes = archive(&[(file, &bytes)])?;
        parts.push(Part {
            name: name.into(),
            url: format!("https://releases.test/{name}"),
            sha256: sha256(&bytes),
        });
        responses.insert(format!("/{name}"), bytes);
    }
    let parts = PartsList::new(parts)?;
    let executable = format!(
        "#!/bin/sh\ncase \"$1\" in\n--version) echo 'conductive 0.0.3';;\nupdate) cat <<'PARTS'\n{}\nPARTS\n;;\nesac\n",
        serde_json::to_string(&parts)?
    );
    let program = archive(&[("conductive", executable.as_bytes())])?;
    let metadata = ReleaseAssetInfo {
        binary: "conductive".into(),
        version: "0.0.3".into(),
        target: "x86_64-unknown-linux-musl".into(),
        asset_name: "program.tar.gz".into(),
        download_url: "https://releases.test/program".into(),
        sha256: Some(sha256(&program)),
    };
    responses.insert(
        "/releases/latest/conductive/x86_64-unknown-linux-musl".into(),
        serde_json::to_vec(&metadata)?,
    );
    responses.insert("/program".into(), program);
    let server = Server::start(responses)?;
    let disk = Arc::new(DiskStore::new(root.path().to_path_buf()));
    let engine = Engine {
        store: disk.clone(),
        client: Arc::new(server.client.clone()),
        installer: Arc::new(TarGzBinaryInstaller::new()),
        processes: Arc::new(SystemProcesses),
    };
    let engine: &dyn UpdateEngine = &engine;
    let check = engine.check("0.0.1").await;
    assert!(
        check.is_ok(),
        "the shipped release failed to stage: {check:?}"
    );
    assert_eq!(disk.versions()?, vec!["0.0.3"]);
    assert_eq!(disk.state()?, State::default());
    assert!(!root.path().join("installed").exists());
    assert_eq!(
        fs::read(disk.version_path("0.0.3").join("node/bin/node"))?,
        b"node bytes"
    );
    disk.prepare("0.0.9")?;
    disk.prepare("0.0.1")?;
    disk.complete("0.0.1", &parts)?;
    disk.transition(&State {
        current: Some("0.0.1".into()),
        ..State::default()
    })?;
    let original = fs::read(disk.version_path("0.0.1").join("conductive"))?;
    {
        let _download = disk.lock()?.ok_or("expected download lock")?;
        assert!(disk.lock()?.is_none());
        engine.apply()?;
        assert_eq!(
            disk.state()?,
            State {
                current: Some("0.0.3".into()),
                previous: Some("0.0.1".into()),
                pending: Some("0.0.3".into()),
            }
        );
        assert!(root.path().join("installed").exists());
        assert_eq!(
            fs::read(disk.version_path("0.0.1").join("conductive"))?,
            original
        );
        engine.started("0.0.3")?;
        assert_eq!(disk.state()?.pending, None);
    }
    let mut staged_parts = parts.clone();
    let staged_bytes = archive(&[("sdk-helper.mjs", b"new helper")])?;
    staged_parts.parts[0].sha256 = sha256(&staged_bytes);
    disk.unpack(&staged_parts.parts[0], &staged_bytes)?;
    disk.prepare("0.0.4")?;
    disk.complete("0.0.4", &staged_parts)?;
    fs::create_dir_all(disk.version_path("incomplete"))?;
    engine.started("0.0.3")?;
    assert!(!disk.version_path("incomplete").exists());
    assert!(
        disk.version_path("0.0.4").join("complete").exists(),
        "confirmation deleted the next release"
    );
    assert!(
        disk.has_part(&staged_parts.parts[0].sha256)?,
        "confirmation deleted the next release's helper"
    );
    let mut kept = disk.versions()?;
    kept.sort();
    assert_eq!(kept, ["0.0.1", "0.0.3", "0.0.4"]);
    disk.transition(&State {
        current: Some("0.0.3".into()),
        previous: Some("0.0.1".into()),
        pending: Some("0.0.3".into()),
    })?;
    engine.apply()?;
    assert_eq!(
        disk.state()?,
        State {
            current: Some("0.0.1".into()),
            previous: None,
            pending: None
        }
    );
    let mut remaining = disk.versions()?;
    remaining.sort();
    assert_eq!(remaining, ["0.0.1", "0.0.4"]);
    engine.started("0.0.1")?;
    assert!(!disk.version_path("0.0.3").exists());
    assert!(disk.rejected("0.0.3")?);
    let recheck = engine.check("0.0.1").await;
    assert!(recheck.is_ok(), "recheck failed: {recheck:?}");
    assert_eq!(
        server
            .requests
            .lock()
            .map_err(|_| "request lock poisoned")?
            .len(),
        6,
        "a rejected release downloaded again"
    );
    assert!(!disk.versions()?.contains(&"0.0.3".to_owned()));
    server.finish()?;
    Ok(())
}
