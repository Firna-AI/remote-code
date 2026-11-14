//! Controlled storage, clock, and startup boundaries for engine integration.

use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use cnd_runner::clock::Clock;
use cnd_runner::disk::Disk;
use cnd_runner::error::{Error, Result};
use cnd_runner::helper::boundary::Startup;
use cnd_runner::json::codec;
use cnd_runner::socket::{Connector, Socket};
use cnd_runner::state::records::RunnerState;
use cnd_runner_interface::runner_handshake::RunnerEventEnvelope;
use tokio::sync::Notify;

#[derive(Default)]
pub(super) struct Memory {
    pub bytes: Mutex<Option<Vec<u8>>>,
    pub fail_kind: Mutex<String>,
    pub failures: Mutex<usize>,
    pub changed: Notify,
}
#[async_trait]
impl Disk for Memory {
    async fn read(&self) -> Result<Option<Vec<u8>>> {
        Ok(self.bytes.lock().or(Err(Error::InvalidCommand))?.clone())
    }
    async fn write(&self, bytes: &[u8]) -> Result<()> {
        let state: RunnerState = codec::decode(bytes)?;
        let fail = self
            .fail_kind
            .lock()
            .or(Err(Error::InvalidCommand))?
            .clone();
        let matches =
            match fail.as_str() {
                "accept" => !state.turns.is_empty() && state.outbox.is_empty(),
                "session" => !state.sessions.is_empty() && state.outbox.is_empty(),
                kind => state.outbox.last().is_some_and(
                    |RunnerEventEnvelope::Event { event, .. }| {
                        serde_json::to_value(event)
                            .ok()
                            .and_then(|v| v.get("type").and_then(|v| v.as_str()).map(str::to_owned))
                            .as_deref()
                            == Some(kind)
                    },
                ),
            };
        let failed = {
            let mut remaining = self.failures.lock().or(Err(Error::InvalidCommand))?;
            let failed = matches && *remaining > 0;
            if failed {
                *remaining -= 1;
            }
            failed
        };
        if failed {
            return Err(Error::Agent {
                code: "save_failed".into(),
                message: "The controlled save failed.".into(),
            });
        }
        *self.bytes.lock().or(Err(Error::InvalidCommand))? = Some(bytes.to_vec());
        self.changed.notify_waiters();
        Ok(())
    }
}

pub(super) struct TestClock(pub AtomicI64);
#[async_trait]
impl Clock for TestClock {
    fn now(&self) -> Result<i64> {
        Ok(self.0.load(Ordering::SeqCst))
    }
    async fn reconnect_delay(&self) {
        std::future::pending::<()>().await;
    }
}
#[derive(Default)]
pub(super) struct Start {
    pub prepares: AtomicUsize,
    pub welcomes: AtomicUsize,
}
#[async_trait]
impl Startup for Start {
    async fn prepare(&self) -> Result<()> {
        self.prepares.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    async fn welcomed(&self) -> Result<()> {
        self.welcomes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}
pub(super) struct NoConnection;
#[async_trait]
impl Connector for NoConnection {
    async fn connect(&self, _: &cnd_runner::config::ConnectionRequest) -> Result<Arc<dyn Socket>> {
        Err(Error::Disconnected)
    }
}
