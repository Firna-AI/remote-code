//! Deterministic archive creation and release filesystem boundary.

use std::fs;
use std::path::Path;

use cli_release_interface::ReleaseAssetInfo;
use flate2::{Compression, GzBuilder};
use sha2::{Digest, Sha256};
use tar::{Builder, Header};

use crate::error::{ErrorResultExt, Result};
use crate::parts::PartsList;
use crate::version::{BASE_URL, BINARY, LATEST_KEY, TARGET, release_version};

/// Filesystem operations used by the release command and build script.
pub trait ReleaseFiles {
    /// Read and validate a typed parts file.
    fn read_parts(&self, path: &Path) -> Result<PartsList>;
    /// Write a validated parts file.
    fn write_parts(&self, path: &Path, parts: &PartsList) -> Result<()>;
    /// Read metadata for the newest-version comparison.
    fn read_metadata(&self, path: &Path) -> Result<ReleaseAssetInfo>;
    /// Write immutable archive and parts files, then the local newest-version JSON.
    fn package(
        &self,
        version: &str,
        program: &Path,
        parts: &PartsList,
        output: &Path,
    ) -> Result<ReleaseAssetInfo>;
}

/// Release files stored on the local filesystem.
pub struct DiskReleaseFiles;

impl ReleaseFiles for DiskReleaseFiles {
    fn read_parts(&self, path: &Path) -> Result<PartsList> {
        let list: PartsList = serde_json::from_slice(&fs::read(path).internal()?).internal()?;
        list.validate()?;
        Ok(list)
    }

    fn write_parts(&self, path: &Path, parts: &PartsList) -> Result<()> {
        parts.validate()?;
        write_file(path, &serde_json::to_vec_pretty(parts).internal()?)
    }

    fn read_metadata(&self, path: &Path) -> Result<ReleaseAssetInfo> {
        serde_json::from_slice(&fs::read(path).internal()?).internal()
    }

    fn package(
        &self,
        version: &str,
        program: &Path,
        parts: &PartsList,
        output: &Path,
    ) -> Result<ReleaseAssetInfo> {
        release_version(version)?;
        parts.validate()?;
        let archive = program_archive(&fs::read(program).internal()?)?;
        let digest = sha256(&archive);
        let asset_name = format!("{BINARY}-{version}-{TARGET}.tar.gz");
        let prefix = format!("releases/download/{BINARY}/{version}");
        let key = format!("{prefix}/{digest}/{asset_name}");
        let metadata = ReleaseAssetInfo {
            binary: BINARY.to_owned(),
            version: version.to_owned(),
            target: TARGET.to_owned(),
            asset_name,
            download_url: format!("{BASE_URL}/{key}"),
            sha256: Some(digest),
        };
        write_file(&output.join(&key), &archive)?;
        let parts_bytes = serde_json::to_vec_pretty(parts).internal()?;
        let parts_key = format!(
            "{prefix}/{}/parts-{version}-{TARGET}.json",
            sha256(&parts_bytes)
        );
        write_file(&output.join(parts_key), &parts_bytes)?;
        write_file(
            &output.join(LATEST_KEY),
            &serde_json::to_vec_pretty(&metadata).internal()?,
        )?;
        Ok(metadata)
    }
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).internal()?;
    }
    fs::write(path, bytes).internal()
}

/// Digest of release bytes, suitable for a filename and updater metadata.
pub fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn program_archive(program: &[u8]) -> Result<Vec<u8>> {
    let gzip = GzBuilder::new()
        .mtime(0)
        .write(Vec::new(), Compression::default());
    let mut archive = Builder::new(gzip);
    let mut header = Header::new_gnu();
    header.set_size(program.len() as u64);
    header.set_mode(0o755);
    header.set_uid(0);
    header.set_gid(0);
    header.set_mtime(0);
    header.set_cksum();
    archive
        .append_data(&mut header, BINARY, program)
        .internal()?;
    archive.into_inner().internal()?.finish().internal()
}
