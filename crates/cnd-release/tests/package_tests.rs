//! Disk integration with the metadata reader and the updater archive installer.

#![expect(
    clippy::unwrap_used,
    reason = "A failed test setup must stop the test."
)]

use std::fs;

use cli_release_interface::ReleaseAssetInfo;
use cli_updater::{BinaryInstaller, TarGzBinaryInstaller};
use cnd_release::files::{DiskReleaseFiles, ReleaseFiles};
use cnd_release::parts::{Part, PartsList};
use cnd_release::version::{BASE_URL, BINARY, LATEST_KEY, TARGET};

#[test]
fn written_release_is_reproducible_and_installable_with_its_required_digest() {
    let directory = tempfile::tempdir().unwrap();
    let program = directory.path().join("input");
    fs::write(&program, b"dummy executable\n").unwrap();
    let parts = PartsList::new(vec![
        Part {
            name: "runner".to_owned(),
            url: format!("{BASE_URL}/runner-{}.tar.gz", "a".repeat(64)),
            sha256: "a".repeat(64),
        },
        Part {
            name: "node".to_owned(),
            url: "https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-x64.tar.gz".to_owned(),
            sha256: "b".repeat(64),
        },
    ])
    .unwrap();
    let first = directory.path().join("first");
    let second = directory.path().join("second");
    let files: &dyn ReleaseFiles = &DiskReleaseFiles;
    files.package("0.0.42", &program, &parts, &first).unwrap();
    files.package("0.0.42", &program, &parts, &second).unwrap();
    let metadata_bytes = fs::read(first.join(LATEST_KEY)).unwrap();
    let metadata: ReleaseAssetInfo = serde_json::from_slice(&metadata_bytes).unwrap();
    assert_eq!(metadata.binary, BINARY);
    assert_eq!(metadata.version, "0.0.42");
    assert_eq!(metadata.target, TARGET);
    assert_eq!(
        metadata.asset_name,
        format!("conductive-0.0.42-{TARGET}.tar.gz")
    );
    let digest = metadata.sha256.as_ref().unwrap();
    assert_eq!(digest.len(), 64);
    assert_eq!(
        metadata.download_url,
        format!(
            "{BASE_URL}/releases/download/conductive/0.0.42/{digest}/{}",
            metadata.asset_name
        )
    );
    let key = metadata
        .download_url
        .strip_prefix(&format!("{BASE_URL}/"))
        .unwrap();
    let archive = fs::read(first.join(key)).unwrap();
    assert_eq!(archive, fs::read(second.join(key)).unwrap());
    assert_eq!(metadata_bytes, fs::read(second.join(LATEST_KEY)).unwrap());
    let part_objects: Vec<_> = fs::read_dir(first.join("releases/download/conductive/0.0.42"))
        .unwrap()
        .flat_map(|entry| fs::read_dir(entry.unwrap().path()).unwrap())
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().unwrap() == "json")
        .collect();
    assert_eq!(part_objects.len(), 1);
    assert_eq!(files.read_parts(&part_objects[0]).unwrap(), parts);
    let installed = directory.path().join(BINARY);
    fs::write(&installed, b"old program").unwrap();
    TarGzBinaryInstaller::new()
        .install(
            &archive,
            BINARY,
            &installed,
            metadata.sha256.as_deref(),
            &metadata.asset_name,
        )
        .unwrap();
    assert_eq!(fs::read(installed).unwrap(), b"dummy executable\n");
}
