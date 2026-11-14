//! Native recursive Linux watches reopen the live path after a restore.

use std::collections::BTreeMap;
use std::mem::MaybeUninit;
use std::os::fd::OwnedFd;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use rustix::fs::inotify::{self, CreateFlags, ReadFlags, WatchFlags};
use rustix::io::Errno;
use tokio::io::unix::AsyncFd;
use tokio::sync::{Mutex, watch};

use crate::error::{Error, ErrorResultExt, Result};

use super::boundary::{RepositoryWatch, WatchDriver};

/// Linux watch and Tokio timing implementation.
pub struct LinuxWatchDriver;

struct LinuxWatch {
    fd: AsyncFd<OwnedFd>,
    root: PathBuf,
    paths: Mutex<BTreeMap<i32, PathBuf>>,
    closed: watch::Sender<bool>,
}

struct NativeEvent {
    descriptor: i32,
    flags: ReadFlags,
    name: Option<PathBuf>,
}

fn add_tree(fd: &OwnedFd, root: &Path, paths: &mut BTreeMap<i32, PathBuf>) -> Result<()> {
    let mut folders = vec![root.to_path_buf()];
    while let Some(folder) = folders.pop() {
        let descriptor = match inotify::add_watch(
            fd,
            &folder,
            WatchFlags::MODIFY
                | WatchFlags::ATTRIB
                | WatchFlags::CREATE
                | WatchFlags::DELETE
                | WatchFlags::DELETE_SELF
                | WatchFlags::MOVE_SELF
                | WatchFlags::MOVED_FROM
                | WatchFlags::MOVED_TO
                | WatchFlags::CLOSE_WRITE
                | WatchFlags::ONLYDIR
                | WatchFlags::DONT_FOLLOW,
        ) {
            Ok(descriptor) => descriptor,
            Err(Errno::NOENT | Errno::NOTDIR) => continue,
            Err(error) => return Err(Error::internal(error)),
        };
        paths.insert(descriptor, folder.clone());
        let entries = match std::fs::read_dir(folder) {
            Ok(entries) => entries,
            Err(error) if vanished(&error) => continue,
            Err(error) => return Err(Error::internal(error)),
        };
        for entry in entries {
            let entry = entry.internal()?;
            let kind = match entry.file_type() {
                Ok(kind) => kind,
                Err(error) if vanished(&error) => continue,
                Err(error) => return Err(Error::internal(error)),
            };
            if kind.is_dir() {
                folders.push(entry.path());
            }
        }
    }
    Ok(())
}

fn vanished(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
    )
}

fn drain(fd: &OwnedFd) -> Result<Vec<NativeEvent>> {
    let mut buffer = [MaybeUninit::uninit(); 65536];
    let mut reader = inotify::Reader::new(fd, &mut buffer);
    let mut events = vec![];
    loop {
        match reader.next() {
            Ok(event) => events.push(NativeEvent {
                descriptor: event.wd(),
                flags: event.events(),
                name: event
                    .file_name()
                    .map(|name| PathBuf::from(name.to_string_lossy().into_owned())),
            }),
            Err(Errno::AGAIN) => break,
            Err(error) => return Err(Error::internal(error)),
        }
    }
    Ok(events)
}

#[async_trait]
impl RepositoryWatch for LinuxWatch {
    async fn changed(&self) -> Result<()> {
        let mut closed = self.closed.subscribe();
        if *closed.borrow() {
            return Err(Error::Disconnected);
        }
        loop {
            tokio::select! {
                biased;
                _ = async { let _ = closed.wait_for(|value| *value).await; } => return Err(Error::Disconnected),
                ready = self.fd.readable() => {
                    let mut ready = ready.internal()?;
                    let events = drain(self.fd.get_ref())?;
                    ready.clear_ready();
                    if events.is_empty() { continue; }
                    let mut paths = self.paths.lock().await;
                    for event in events {
                        if event.flags.contains(ReadFlags::QUEUE_OVERFLOW) {
                            add_tree(self.fd.get_ref(), &self.root, &mut paths)?;
                        } else if event.flags.contains(ReadFlags::ISDIR) && event.flags.intersects(ReadFlags::CREATE | ReadFlags::MOVED_TO)
                            && let Some(parent) = paths.get(&event.descriptor).cloned()
                            && let Some(name) = event.name {
                                add_tree(self.fd.get_ref(), &parent.join(name), &mut paths)?;
                            }
                        if event.flags.contains(ReadFlags::IGNORED) { paths.remove(&event.descriptor); }
                    }
                    return Ok(());
                },
            }
        }
    }

    async fn close(&self) {
        self.closed.send_replace(true);
    }
}

#[async_trait]
impl WatchDriver for LinuxWatchDriver {
    async fn open(&self, root: PathBuf) -> Result<Arc<dyn RepositoryWatch>> {
        let fd = inotify::init(CreateFlags::NONBLOCK | CreateFlags::CLOEXEC).internal()?;
        let mut paths = BTreeMap::new();
        add_tree(&fd, &root, &mut paths)?;
        #[expect(
            deprecated,
            reason = "OwnedFd owns the descriptor throughout the AsyncFd lifetime"
        )]
        let fd = AsyncFd::new(fd).internal()?;
        Ok(Arc::new(LinuxWatch {
            fd,
            root,
            paths: Mutex::new(paths),
            closed: watch::channel(false).0,
        }))
    }
    async fn exists(&self, marker: PathBuf) -> bool {
        tokio::fs::metadata(marker).await.is_ok()
    }
    async fn delay(&self, duration: Duration) {
        tokio::time::sleep(duration).await;
    }
}
