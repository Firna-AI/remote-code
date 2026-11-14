//! Mock release clients, installers, and shared test data.

use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use cli_release_interface::ReleaseAssetInfo;
use cli_updater::{BinaryInstaller, ReleaseClient};
use cnd_release::files::sha256;
use cnd_release::parts::{Part, PartsList};
use unimock::{MockFn, Unimock, matching};

use super::engine::Engine;
use super::ports::{StoreMock, UpdateLock};

#[unimock::unimock(api = ClientMock)]
#[async_trait]
pub(super) trait Client {
    async fn latest(&self, binary: &str, target: &str) -> cli_updater::Result<ReleaseAssetInfo>;
    async fn download(&self, release: &ReleaseAssetInfo) -> cli_updater::Result<Vec<u8>>;
}

#[unimock::unimock(api = InstallerMock)]
pub(super) trait Installer {
    fn install(
        &self,
        archive_bytes: &[u8],
        binary: &str,
        current_exe: &Path,
        expected_sha256: Option<&str>,
        asset_name: &str,
    ) -> cli_updater::Result<()>;
}

struct Lock;
impl UpdateLock for Lock {}

pub(super) fn locked() -> Option<Box<dyn UpdateLock>> {
    Some(Box::new(Lock))
}

pub(super) fn release(version: &str) -> ReleaseAssetInfo {
    ReleaseAssetInfo {
        binary: "conductive".into(),
        version: version.into(),
        target: "x86_64-unknown-linux-musl".into(),
        asset_name: "program.tar.gz".into(),
        download_url: "https://releases.test/program.tar.gz".into(),
        sha256: Some("a".repeat(64)),
    }
}

pub(super) fn parts() -> cnd_release::error::Result<PartsList> {
    PartsList::new(
        ["sdk-helper", "node", "system"]
            .into_iter()
            .map(|name| Part {
                name: name.into(),
                url: format!("https://releases.test/{name}.tar.gz"),
                sha256: sha256(name.as_bytes()),
            })
            .collect(),
    )
}

pub(super) fn engine(
    store: Unimock,
    client: Unimock,
    installer: Unimock,
    processes: Unimock,
) -> Engine {
    Engine {
        store: Arc::new(store),
        client: Arc::new(Network(client)),
        installer: Arc::new(Archive(installer)),
        processes: Arc::new(processes),
    }
}

pub(super) fn lock_only() -> Unimock {
    Unimock::new(StoreMock::lock.some_call(matching!()).returns(Ok(locked())))
}

struct Network(Unimock);
#[async_trait]
impl ReleaseClient for Network {
    async fn latest(&self, binary: &str, target: &str) -> cli_updater::Result<ReleaseAssetInfo> {
        Client::latest(&self.0, binary, target).await
    }
    async fn download(&self, release: &ReleaseAssetInfo) -> cli_updater::Result<Vec<u8>> {
        Client::download(&self.0, release).await
    }
}
struct Archive(Unimock);
impl BinaryInstaller for Archive {
    fn install(
        &self,
        archive_bytes: &[u8],
        binary: &str,
        current_exe: &Path,
        expected_sha256: Option<&str>,
        asset_name: &str,
    ) -> cli_updater::Result<()> {
        Installer::install(
            &self.0,
            archive_bytes,
            binary,
            current_exe,
            expected_sha256,
            asset_name,
        )
    }
}
