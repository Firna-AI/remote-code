//! Resolve new listening sockets through process descriptors and cache complete labels.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use cnd_runner_interface::ports::ListeningPort;
use tokio::sync::Mutex;

use crate::error::{ErrorResultExt, Result};

use super::metadata::{port_folder, port_name};
use super::reporter::PortScanner;
use super::sockets::listening_sockets;

/// Read only socket tables, selected process arguments, and descriptor links.
#[cfg_attr(test, unimock::unimock(api = ProcReaderMock))]
#[async_trait]
pub trait ProcReader: Send + Sync {
    /// Read bytes as UTF-8 with replacement, as Node's proc reader does.
    async fn read(&self, path: String) -> Result<String>;
    /// List directory entry names.
    async fn list(&self, path: String) -> Result<Vec<String>>;
    /// Read one symbolic link.
    async fn link(&self, path: String) -> Result<String>;
}

/// Linux /proc reader. No method reads process environments or contacts a server.
pub struct DiskProcReader;

#[async_trait]
impl ProcReader for DiskProcReader {
    async fn read(&self, path: String) -> Result<String> {
        Ok(String::from_utf8_lossy(&tokio::fs::read(path).await.internal()?).into_owned())
    }
    async fn list(&self, path: String) -> Result<Vec<String>> {
        let mut directory = tokio::fs::read_dir(path).await.internal()?;
        let mut entries = vec![];
        while let Some(entry) = directory.next_entry().await.internal()? {
            entries.push(entry.file_name().to_string_lossy().into_owned());
        }
        Ok(entries)
    }
    async fn link(&self, path: String) -> Result<String> {
        Ok(tokio::fs::read_link(path)
            .await
            .internal()?
            .to_string_lossy()
            .into_owned())
    }
}

type Labels = (Option<String>, Option<String>);

/// Scanner whose metadata lives for exactly one socket identity.
pub struct ProcPortScanner {
    reader: Arc<dyn ProcReader>,
    uid: u32,
    home: PathBuf,
    root: PathBuf,
    metadata: Mutex<BTreeMap<String, Labels>>,
}

impl ProcPortScanner {
    /// Compose the scanner with the service user's UID and repository roots.
    pub fn new(reader: Arc<dyn ProcReader>, uid: u32, home: PathBuf, root: PathBuf) -> Self {
        Self {
            reader,
            uid,
            home,
            root,
            metadata: Mutex::new(BTreeMap::new()),
        }
    }

    async fn find_metadata(&self, mut remaining: BTreeSet<String>) -> BTreeMap<String, Labels> {
        let mut result = BTreeMap::new();
        if remaining.is_empty() {
            return result;
        }
        let mut pids = self.reader.list("/proc".into()).await.unwrap_or_default();
        pids.retain(|pid| !pid.is_empty() && pid.bytes().all(|byte| byte.is_ascii_digit()));
        pids.sort();
        for pid in pids {
            if remaining.is_empty() {
                break;
            }
            let descriptors = self
                .reader
                .list(format!("/proc/{pid}/fd"))
                .await
                .unwrap_or_default();
            let mut owned = BTreeSet::new();
            for descriptor in descriptors {
                if descriptor.is_empty() || !descriptor.bytes().all(|byte| byte.is_ascii_digit()) {
                    continue;
                }
                if let Ok(target) = self
                    .reader
                    .link(format!("/proc/{pid}/fd/{descriptor}"))
                    .await
                    && let Some(inode) = target
                        .strip_prefix("socket:[")
                        .and_then(|target| target.strip_suffix(']'))
                    && remaining.contains(inode)
                {
                    owned.insert(inode.to_owned());
                }
            }
            if owned.is_empty() {
                continue;
            }
            let command = self.reader.read(format!("/proc/{pid}/cmdline")).await.ok();
            let folder = self.reader.link(format!("/proc/{pid}/cwd")).await.ok();
            let executable = self.reader.link(format!("/proc/{pid}/exe")).await.ok();
            let name = command
                .zip(executable)
                .and_then(|(command, executable)| port_name(&command, &executable));
            let folder = folder.and_then(|folder| port_folder(&folder, &self.home, &self.root));
            for inode in owned {
                remaining.remove(&inode);
                result.insert(inode, (name.clone(), folder.clone()));
            }
        }
        result
    }
}

#[async_trait]
impl PortScanner for ProcPortScanner {
    async fn scan(&self) -> Result<Vec<ListeningPort>> {
        let mut metadata = self.metadata.lock().await;
        let ipv4 = self.reader.read("/proc/net/tcp".into()).await?;
        let ipv6 = self.reader.read("/proc/net/tcp6".into()).await?;
        let mut sockets = listening_sockets(&ipv4, false, self.uid);
        sockets.extend(listening_sockets(&ipv6, true, self.uid));
        sockets.sort_by(|a, b| {
            a.port
                .cmp(&b.port)
                .then_with(|| a.identity.cmp(&b.identity))
        });
        let missing = sockets
            .iter()
            .filter(|socket| !metadata.contains_key(&socket.identity))
            .map(|socket| socket.inode.clone())
            .collect();
        let resolved = self.find_metadata(missing).await;
        let mut current = BTreeMap::new();
        let mut ports = BTreeMap::new();
        for socket in sockets {
            let labels = metadata
                .get(&socket.identity)
                .or_else(|| resolved.get(&socket.inode))
                .cloned()
                .unwrap_or_default();
            current.insert(socket.identity, labels.clone());
            ports.entry(socket.port).or_insert(ListeningPort {
                port: socket.port,
                name: labels.0,
                folder: labels.1,
            });
        }
        *metadata = current;
        Ok(ports.into_values().collect())
    }
}

#[cfg(test)]
#[path = "../_tests_/proc_ports_tests.rs"]
mod proc_ports_tests;
