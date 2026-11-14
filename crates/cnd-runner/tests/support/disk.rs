//! Memory disk with explicit write barriers and failure controls.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use async_trait::async_trait;
use cnd_runner::disk::Disk;
use cnd_runner::error::{Error, Result};
use tokio::sync::Notify;

#[derive(Default)]
pub(crate) struct ControlledDisk {
    pub bytes: Mutex<Option<Vec<u8>>>,
    pub fail: AtomicBool,
    pub hold: AtomicBool,
    pub arrived: Notify,
    pub release: Notify,
}

#[async_trait]
impl Disk for ControlledDisk {
    async fn read(&self) -> Result<Option<Vec<u8>>> {
        Ok(self.bytes.lock().unwrap().clone())
    }
    async fn write(&self, bytes: &[u8]) -> Result<()> {
        if self.hold.swap(false, Ordering::SeqCst) {
            self.arrived.notify_one();
            self.release.notified().await;
        }
        if self.fail.swap(false, Ordering::SeqCst) {
            return Err(Error::Disconnected);
        }
        *self.bytes.lock().unwrap() = Some(bytes.to_vec());
        Ok(())
    }
}
