//! Download and verify a release under the caller's download lock.

use cli_release_interface::ReleaseAssetInfo;
use cli_updater::{UpdateCheck, Updater};
use cnd_release::files::sha256;
use cnd_release::version::{BINARY, TARGET, release_version};

use super::engine::Engine;
use super::error::{Error, ErrorResultExt, Result};
use super::ports::UpdateLock;

impl Engine {
    pub(super) async fn download(&self, running: &str, _lock: Box<dyn UpdateLock>) -> Result<()> {
        let updater = Updater::new(self.client.clone(), self.installer.clone());
        let status = updater
            .status(UpdateCheck {
                binary: BINARY.to_owned(),
                current_version: running.to_owned(),
                target: TARGET.to_owned(),
            })
            .await
            .internal()?;
        if !status.update_available {
            return Ok(());
        }
        let release = status.latest;
        release_version(&release.version).internal()?;
        if release.binary != BINARY || release.target != TARGET {
            return Err(Error::InvalidRelease);
        }
        let digest = release.sha256.as_deref().ok_or(Error::MissingDigest)?;
        if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(Error::MissingDigest);
        }
        if self.store.versions()?.contains(&release.version)
            || self.store.rejected(&release.version)?
        {
            return Ok(());
        }
        let state = self.store.state()?;
        if let Some(current) = state.current
            && release_version(&release.version).internal()?
                <= release_version(&current).internal()?
        {
            return Ok(());
        }
        let archive = self.client.download(&release).await.internal()?;
        self.store.prepare(&release.version)?;
        let executable = self.store.version_path(&release.version).join(BINARY);
        self.installer
            .install(
                &archive,
                BINARY,
                &executable,
                Some(digest),
                &release.asset_name,
            )
            .internal()?;
        let parts = self.processes.inspect(&executable, &release.version)?;
        parts.validate().internal()?;
        for part in &parts.parts {
            if self.store.has_part(&part.sha256)? {
                continue;
            }
            let asset = ReleaseAssetInfo {
                binary: part.name.clone(),
                version: release.version.clone(),
                target: TARGET.to_owned(),
                asset_name: part.name.clone(),
                download_url: part.url.clone(),
                sha256: Some(part.sha256.clone()),
            };
            let bytes = self.client.download(&asset).await.internal()?;
            if !sha256(&bytes).eq_ignore_ascii_case(&part.sha256) {
                return Err(Error::DigestMismatch {
                    name: part.name.clone(),
                });
            }
            self.store.unpack(part, &bytes)?;
        }
        self.store.complete(&release.version, &parts)
    }
}
