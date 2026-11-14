//! Injectable filesystem operations for repository comparisons.

use std::fs::{self, File};
use std::io::Read;
use std::os::fd::AsRawFd;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use rustix::fs::{Mode, OFlags, open};
use sha2::{Digest, Sha256};
use tempfile::TempDir;

use super::access::safe_path;
use super::error::{Error, ErrorResultExt, Result};

/// Physical kinds do not follow links in the Git namespace.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathKind {
    /// No entry, or a child of a non-directory.
    Absent,
    /// A regular file.
    File,
    /// A symbolic link.
    Link,
    /// A directory, possibly a submodule.
    Directory,
    /// A pipe, socket, device, or other unsupported kind.
    Special,
}

/// A private temporary directory whose lifetime covers an index operation.
pub struct IndexDirectory {
    directory: TempDir,
}

impl IndexDirectory {
    /// Root of private temporary index and object storage.
    pub fn path(&self) -> &Path {
        self.directory.path()
    }
}

/// Disk boundary shared by scans, reads, and diffs.
#[cfg_attr(test, unimock::unimock(api = RepositoryIoMock))]
#[async_trait]
pub trait RepositoryIo: Send + Sync {
    /// Add the context exclusion once and create context attachment storage.
    async fn prepare_context(&self, root: PathBuf, exclude: PathBuf) -> Result<()>;
    /// Inspect an entry without following its link.
    async fn kind(&self, path: PathBuf) -> Result<PathKind>;
    /// Read through a verified descriptor and enforce the effective cap.
    async fn read(&self, root: PathBuf, path: String, max_bytes: u64) -> Result<Vec<u8>>;
    /// Read link text after checking the real parent.
    async fn link(&self, root: PathBuf, path: String) -> Result<Vec<u8>>;
    /// Stream all readable bytes to detect changes outside Git representations.
    async fn identity(&self, root: PathBuf, path: String) -> Result<String>;
    /// Create private storage and copy the real index when it exists.
    async fn temporary_index(&self, index: PathBuf) -> Result<IndexDirectory>;
}

/// Linux filesystem implementation. Descriptor checks prevent parent-swap escapes.
pub struct LocalRepositoryIo;

fn file_error(error: std::io::Error) -> Error {
    if error.kind() == std::io::ErrorKind::NotFound {
        Error::NotFound
    } else {
        Error::Unavailable
    }
}

fn inside(root: &Path, target: &Path) -> bool {
    target
        .strip_prefix(root)
        .is_ok_and(|relative| !relative.components().any(|part| part.as_os_str() == ".git"))
}

fn verified_file(root: &Path, path: &str) -> Result<File> {
    safe_path(path)?;
    let canonical = match fs::canonicalize(root) {
        Ok(path) => path,
        Err(error) => return Err(file_error(error)),
    };
    let target = match fs::canonicalize(root.join(path)) {
        Ok(path) => path,
        Err(error) => return Err(file_error(error)),
    };
    if !inside(&canonical, &target) {
        return Err(Error::Unavailable);
    }
    let file: File = match open(
        target,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
        Mode::empty(),
    ) {
        Ok(file) => file.into(),
        Err(error) => return Err(file_error(error.into())),
    };
    let opened = match fs::canonicalize(format!("/proc/self/fd/{}", file.as_raw_fd())) {
        Ok(path) => path,
        Err(error) => return Err(file_error(error)),
    };
    if !inside(&canonical, &opened) || !file.metadata().internal()?.is_file() {
        return Err(Error::Unavailable);
    }
    Ok(file)
}

#[async_trait]
impl RepositoryIo for LocalRepositoryIo {
    async fn prepare_context(&self, root: PathBuf, exclude: PathBuf) -> Result<()> {
        tokio::task::spawn_blocking(move || super::setup::prepare(&root, &exclude))
            .await
            .internal()?
    }

    async fn kind(&self, path: PathBuf) -> Result<PathKind> {
        match tokio::fs::symlink_metadata(path).await {
            Ok(info) => Ok(if info.is_symlink() {
                PathKind::Link
            } else if info.is_dir() {
                PathKind::Directory
            } else if info.is_file() {
                PathKind::File
            } else {
                PathKind::Special
            }),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
                ) =>
            {
                Ok(PathKind::Absent)
            }
            Err(error) => Err(Error::internal(error)),
        }
    }

    async fn read(&self, root: PathBuf, path: String, max_bytes: u64) -> Result<Vec<u8>> {
        tokio::task::spawn_blocking(move || {
            let file = verified_file(&root, &path)?;
            let size = file.metadata().internal()?.len();
            if size > max_bytes {
                return Err(Error::TooLarge {
                    size,
                    limit: max_bytes,
                });
            }
            let mut bytes = Vec::new();
            file.take(size + 1).read_to_end(&mut bytes).internal()?;
            let length = bytes.len() as u64;
            if length > max_bytes {
                return Err(Error::TooLarge {
                    size: length,
                    limit: max_bytes,
                });
            }
            if length > size {
                return Err(Error::Unavailable);
            }
            Ok(bytes)
        })
        .await
        .internal()?
    }

    async fn link(&self, root: PathBuf, path: String) -> Result<Vec<u8>> {
        safe_path(&path)?;
        let root = tokio::fs::canonicalize(root).await.internal()?;
        let target = root.join(&path);
        let parent = target.parent().ok_or(Error::Unavailable)?;
        let parent = tokio::fs::canonicalize(parent).await.internal()?;
        if !inside(&root, &parent) {
            return Err(Error::Unavailable);
        }
        let name = target.file_name().ok_or(Error::Unavailable)?;
        Ok(tokio::fs::read_link(parent.join(name))
            .await
            .internal()?
            .as_os_str()
            .as_encoded_bytes()
            .to_vec())
    }

    async fn identity(&self, root: PathBuf, path: String) -> Result<String> {
        tokio::task::spawn_blocking(move || {
            let mut file = match verified_file(&root, &path) {
                Ok(file) => file,
                Err(_) => return Ok("unavailable".into()),
            };
            let mut hash = Sha256::new();
            let mut buffer = [0; 65536];
            loop {
                let count = match file.read(&mut buffer) {
                    Ok(count) => count,
                    Err(_) => return Ok("unavailable".into()),
                };
                if count == 0 {
                    break;
                }
                hash.update(&buffer[..count]);
            }
            Ok(hash
                .finalize()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect())
        })
        .await
        .internal()?
    }

    async fn temporary_index(&self, index: PathBuf) -> Result<IndexDirectory> {
        let directory = tempfile::Builder::new()
            .prefix("conductive-git-")
            .tempdir()
            .internal()?;
        tokio::fs::create_dir(directory.path().join("objects"))
            .await
            .internal()?;
        match tokio::fs::copy(index, directory.path().join("index")).await {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(Error::internal(error)),
        }
        Ok(IndexDirectory { directory })
    }
}
