//! Atomic state-file replacement with private Unix permissions.

use std::io::ErrorKind;
use std::path::PathBuf;

use async_trait::async_trait;
use tokio::fs::{self, DirBuilder, OpenOptions};
use tokio::io::AsyncWriteExt;

use crate::error::{ErrorResultExt, Result};

/// Read and atomically replace the runner's complete state.
#[cfg_attr(test, unimock::unimock(api = DiskMock))]
#[async_trait]
pub trait Disk: Send + Sync {
    /// Missing state is a first start. Other read failures stop startup.
    async fn read(&self) -> Result<Option<Vec<u8>>>;
    /// Success means that later reads see this complete state.
    async fn write(&self, bytes: &[u8]) -> Result<()>;
}

/// The Node-compatible state file and its adjacent `.next` file.
pub struct AtomicDisk {
    path: PathBuf,
}

impl AtomicDisk {
    /// Configure a state path without performing IO.
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

#[async_trait]
impl Disk for AtomicDisk {
    async fn read(&self) -> Result<Option<Vec<u8>>> {
        match fs::read(&self.path).await {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).internal(),
        }
    }

    async fn write(&self, bytes: &[u8]) -> Result<()> {
        if let Some(parent) = self.path.parent().filter(|p| !p.as_os_str().is_empty()) {
            let mut builder = DirBuilder::new();
            builder.recursive(true);
            #[cfg(unix)]
            builder.mode(0o700);
            builder.create(parent).await.internal()?;
        }
        let mut temporary = self.path.as_os_str().to_os_string();
        temporary.push(".next");
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options.open(&temporary).await.internal()?;
        file.write_all(bytes).await.internal()?;
        file.flush().await.internal()?;
        fs::rename(&temporary, &self.path).await.internal()?;
        Ok(())
    }
}
